import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSandboxRouteParams,
  buildSandboxRouteRequest,
} from "./sandbox-record-route-test-harness";
import {
  buildSandboxServiceAiAccess,
  buildOwnedSandboxServiceRecord,
  buildSandboxServiceRecordRepo,
  buildSandboxServiceRouteAuth,
} from "./sandbox-service-route-test-harness";
import { isClosedSandboxStreamError } from "../../app/api/sandbox/[id]/harness/route";
import {
  buildAiCall,
  parseSseEvents,
  buildHarnessGitDeliveryDeps,
  loadSandboxHarnessRouteModule,
} from "./helpers/sandbox-harness-route-fixtures";

test("closed sandbox streams are recognized for lifecycle reconciliation", () => {
  assert.equal(
    isClosedSandboxStreamError(
      new Error("Sandbox stream was closed and is not accepting commands.")
    ),
    true
  );
  assert.equal(
    isClosedSandboxStreamError(new Error("Provider returned 429")),
    false
  );
});

test("POST /api/sandbox/[id]/harness persists classified failures and returns them in the done event", async () => {
  const { createSandboxHarnessPostHandler } =
    await loadSandboxHarnessRouteModule();
  const aiCall = buildAiCall();
  let persistedStatus: string | undefined;
  let persistedError: string | null | undefined;
  let billingResumeHookAttached = false;
  let executionLeaseMs: number | undefined;

  const handler = createSandboxHarnessPostHandler({
    ...buildHarnessGitDeliveryDeps(),
    getSandboxServiceCredentials: async () => buildSandboxServiceRouteAuth(),
    loadOwnedSandboxRecord: async () =>
      buildOwnedSandboxServiceRecord({
        repo: buildSandboxServiceRecordRepo({
          github_installation_id: 123,
        }),
      }),
    resolveSandboxAiAccess: async () =>
      buildSandboxServiceAiAccess({
        aiBillingSource: "user_ai_gateway",
        gatewayApiKey: "gateway-key",
      }),
    getSandbox: async (_name, _credentials, options) => {
      billingResumeHookAttached = typeof options?.onResume === "function";
      return {} as never;
    },
    runHarness: async () => {
      assert.equal(executionLeaseMs, 35 * 60_000);
      return {
        installed: false,
        installLogs: "",
        command: {
          cmdId: "cmd-123",
          async *logs() {
            yield {
              stream: "stderr" as const,
              data: "API Error: HTTP 429 rate limit exceeded\n",
            };
          },
          wait: async () => ({ exitCode: 1 }),
          kill: async () => {},
        },
      } as never;
    },
    renewSandboxActivityLease: async (_sandbox, _now, leaseMs) => {
      executionLeaseMs = leaseMs;
      return 0;
    },
    stopSandboxRecord: async () => null,
    touchSandboxLastActive: async () => {},
    resolveRepoSandboxEnv: async () => ({
      envVars: {},
      sync: { mode: "sandbox-only", source: "manual", warning: null },
    }),
    createAiCall: async () => aiCall,
    loadOwnedAiCall: async () => aiCall,
    mergeAiCallMetadata: async () => {
      throw new Error("mergeAiCallMetadata should not be called");
    },
    updateAiCall: async () => {},
    finalizeAiCallAsCancelledIfActive: async () => {
      throw new Error("cancel finalization should not be called");
    },
    finalizeAiCallIfNotCancelled: async (_aiCallId, update) => {
      persistedStatus = update.status;
      persistedError = update.error;
      return buildAiCall({
        status: update.status ?? "failed",
        error: update.error ?? null,
      });
    },
    safeAppendAiCallEvent: async () => null,
    loadHarnessPromptWithMemoryContext: async (_userId, prompt) => prompt,
    persistHarnessMemory: async () => {},
  });

  const response = await handler(
    buildSandboxRouteRequest({
      method: "POST",
      suffix: "/harness",
      init: {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ harness: "codex", prompt: "Review this repo" }),
      },
    }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 200);
  const events = parseSseEvents(await response.text());
  const done = events.find((event) => event.type === "done");
  const expectedError =
    "OpenAI rate-limited this run. Wait a moment, then try again.";
  assert.equal(persistedStatus, "failed");
  assert.equal(persistedError, expectedError);
  assert.equal(billingResumeHookAttached, true);
  assert.deepEqual(done, {
    type: "done",
    exitCode: 1,
    error: expectedError,
    failureCode: "rate_limited",
  });
});

test("POST /api/sandbox/[id]/harness delivers successful changes through a pull request", async () => {
  const { createSandboxHarnessPostHandler } =
    await loadSandboxHarnessRouteModule();
  const aiCall = buildAiCall();
  const pullRequestUrl = "https://github.com/acme/repo/pull/42";
  const worktreeId = "11111111-2222-4333-8444-555555555555";
  const checkoutPath = `/vercel/sandbox/.worktrees/${worktreeId}`;
  let completionMetadata: Record<string, unknown> | undefined;
  let publishedPrompt: string | undefined;
  let synchronizedCwd: string | undefined;
  let harnessCwd: string | undefined;

  const handler = createSandboxHarnessPostHandler({
    ...buildHarnessGitDeliveryDeps(),
    loadOwnedWorktreeBinding: async (input) => {
      assert.deepEqual(input, {
        worktreeId,
        userId: "user-123",
        sandboxId: "sandbox-1",
        repoId: "repo-123",
      });
      return {
        id: worktreeId,
        sandbox_id: "sandbox-1",
        repo_id: "repo-123",
        branch_name: "mogplex/task/mission/checkout",
        base_branch: "main",
        checkout_path: checkoutPath,
        status: "active",
      };
    },
    syncHarnessGitWorkspace: async (_sandbox, input) => {
      synchronizedCwd = input.cwd;
      return {
        baseBranch: input.baseBranch,
        workingBranch: input.workingBranch,
        createdBranch: false,
      };
    },
    publishHarnessPullRequest: async (_sandbox, input) => {
      publishedPrompt = input.prompt;
      return {
        pullRequestUrl,
        changed: true,
        autoCommittedFiles: ["components/checkout.tsx"],
      };
    },
    getSandboxServiceCredentials: async () => buildSandboxServiceRouteAuth(),
    loadOwnedSandboxRecord: async () =>
      buildOwnedSandboxServiceRecord({
        repo: buildSandboxServiceRecordRepo({
          github_installation_id: 123,
        }),
      }),
    resolveSandboxAiAccess: async () =>
      buildSandboxServiceAiAccess({
        aiBillingSource: "user_ai_gateway",
        gatewayApiKey: "gateway-key",
      }),
    getSandbox: async () => ({}) as never,
    runHarness: async (_sandbox, _harness, _prompt, _env, options) => {
      harnessCwd = options?.cwd;
      return {
        installed: false,
        installLogs: "",
        command: {
          cmdId: "cmd-success",
          async *logs() {
            yield { stream: "stdout" as const, data: "Implemented fix\n" };
          },
          wait: async () => ({ exitCode: 0 }),
          kill: async () => {},
        },
      } as never;
    },
    renewSandboxActivityLease: async () => 0,
    stopSandboxRecord: async () => null,
    touchSandboxLastActive: async () => {},
    resolveRepoSandboxEnv: async () => ({
      envVars: {},
      sync: { mode: "sandbox-only", source: "manual", warning: null },
    }),
    createAiCall: async () => aiCall,
    loadOwnedAiCall: async () => aiCall,
    mergeAiCallMetadata: async () => {
      throw new Error("mergeAiCallMetadata should not be called");
    },
    updateAiCall: async () => {},
    finalizeAiCallAsCancelledIfActive: async () => {
      throw new Error("cancel finalization should not be called");
    },
    finalizeAiCallIfNotCancelled: async (_aiCallId, update) => {
      completionMetadata = update.metadata;
      return buildAiCall({ status: "success", metadata: update.metadata });
    },
    safeAppendAiCallEvent: async () => null,
    loadHarnessPromptWithMemoryContext: async (_userId, prompt) => prompt,
    persistHarnessMemory: async () => {},
  });

  const response = await handler(
    buildSandboxRouteRequest({
      method: "POST",
      suffix: "/harness",
      init: {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          harness: "codex",
          prompt: "Fix checkout",
          worktreeId,
        }),
      },
    }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 200);
  const events = parseSseEvents(await response.text());
  assert.deepEqual(
    events.find((event) => event.type === "done"),
    {
      type: "done",
      exitCode: 0,
      error: null,
      failureCode: null,
      pullRequestUrl,
    }
  );
  assert.equal(completionMetadata?.pull_request_url, pullRequestUrl);
  assert.equal(
    completionMetadata?.working_branch,
    "mogplex/task/mission/checkout"
  );
  assert.deepEqual(completionMetadata?.auto_committed_files, [
    "components/checkout.tsx",
  ]);
  assert.equal(publishedPrompt, "Fix checkout");
  assert.equal(synchronizedCwd, checkoutPath);
  assert.equal(harnessCwd, checkoutPath);
  assert.match(
    String(
      events.find(
        (event) =>
          event.type === "log" &&
          String(event.data).includes("automatic commit")
      )?.data
    ),
    /components\/checkout\.tsx/
  );
});

test("POST /api/sandbox/[id]/harness reports pull request delivery failures", async (t) => {
  t.mock.method(console, "error", () => {});
  const { createSandboxHarnessPostHandler } =
    await loadSandboxHarnessRouteModule();
  const aiCall = buildAiCall();
  let persistedError: string | null | undefined;
  const handler = createSandboxHarnessPostHandler({
    ...buildHarnessGitDeliveryDeps(),
    publishHarnessPullRequest: async () => {
      throw new Error("GitHub refused the push");
    },
    getSandboxServiceCredentials: async () => buildSandboxServiceRouteAuth(),
    loadOwnedSandboxRecord: async () =>
      buildOwnedSandboxServiceRecord({
        repo: buildSandboxServiceRecordRepo({ github_installation_id: 123 }),
      }),
    resolveSandboxAiAccess: async () =>
      buildSandboxServiceAiAccess({
        aiBillingSource: "user_ai_gateway",
        gatewayApiKey: "gateway-key",
      }),
    getSandbox: async () => ({}) as never,
    runHarness: async () =>
      ({
        installed: false,
        installLogs: "",
        command: {
          cmdId: "cmd-delivery-failure",
          async *logs() {},
          wait: async () => ({ exitCode: 0 }),
          kill: async () => {},
        },
      }) as never,
    renewSandboxActivityLease: async () => 0,
    stopSandboxRecord: async () => null,
    touchSandboxLastActive: async () => {},
    resolveRepoSandboxEnv: async () => ({
      envVars: {},
      sync: { mode: "sandbox-only", source: "manual", warning: null },
    }),
    createAiCall: async () => aiCall,
    loadOwnedAiCall: async () => aiCall,
    mergeAiCallMetadata: async () => aiCall,
    updateAiCall: async () => {},
    finalizeAiCallAsCancelledIfActive: async () => null,
    finalizeAiCallIfNotCancelled: async (_aiCallId, update) => {
      persistedError = update.error;
      return buildAiCall({ status: "failed", error: update.error ?? null });
    },
    safeAppendAiCallEvent: async () => null,
    loadHarnessPromptWithMemoryContext: async (_userId, prompt) => prompt,
    persistHarnessMemory: async () => {},
  });

  const response = await handler(
    buildSandboxRouteRequest({
      method: "POST",
      suffix: "/harness",
      init: {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ harness: "codex", prompt: "Fix checkout" }),
      },
    }),
    buildSandboxRouteParams()
  );
  const events = parseSseEvents(await response.text());

  assert.equal(persistedError, "GitHub refused the push");
  assert.deepEqual(
    events.find((event) => event.type === "error"),
    {
      type: "error",
      data: "GitHub refused the push",
    }
  );
});

test("POST /api/sandbox/[id]/harness never publishes after cancellation", async () => {
  const { createSandboxHarnessPostHandler } =
    await loadSandboxHarnessRouteModule();
  const aiCall = buildAiCall();
  let callLoads = 0;
  let publishCalled = false;
  const cancelledCall = buildAiCall({
    status: "streaming",
    control_state: "cancel_requested",
    cancel_requested_at: "2026-08-05T00:00:01.000Z",
  });
  const handler = createSandboxHarnessPostHandler({
    ...buildHarnessGitDeliveryDeps(),
    publishHarnessPullRequest: async () => {
      publishCalled = true;
      return {
        pullRequestUrl: null,
        changed: false,
        autoCommittedFiles: [],
      };
    },
    getSandboxServiceCredentials: async () => buildSandboxServiceRouteAuth(),
    loadOwnedSandboxRecord: async () =>
      buildOwnedSandboxServiceRecord({
        repo: buildSandboxServiceRecordRepo({ github_installation_id: 123 }),
      }),
    resolveSandboxAiAccess: async () =>
      buildSandboxServiceAiAccess({
        aiBillingSource: "user_ai_gateway",
        gatewayApiKey: "gateway-key",
      }),
    getSandbox: async () => ({}) as never,
    runHarness: async () =>
      ({
        installed: false,
        installLogs: "",
        command: {
          cmdId: "cmd-cancelled",
          async *logs() {
            yield { stream: "stdout" as const, data: "Working\n" };
          },
          wait: async () => ({ exitCode: 0 }),
          kill: async () => {},
        },
      }) as never,
    renewSandboxActivityLease: async () => 0,
    stopSandboxRecord: async () => null,
    touchSandboxLastActive: async () => {},
    resolveRepoSandboxEnv: async () => ({
      envVars: {},
      sync: { mode: "sandbox-only", source: "manual", warning: null },
    }),
    createAiCall: async () => aiCall,
    loadOwnedAiCall: async () => {
      callLoads += 1;
      return callLoads === 1 ? aiCall : cancelledCall;
    },
    mergeAiCallMetadata: async () => cancelledCall,
    updateAiCall: async () => {},
    finalizeAiCallAsCancelledIfActive: async () =>
      buildAiCall({ status: "cancelled", control_state: "cancelled" }),
    finalizeAiCallIfNotCancelled: async () => {
      throw new Error("cancelled run should not complete normally");
    },
    safeAppendAiCallEvent: async () => null,
    loadHarnessPromptWithMemoryContext: async (_userId, prompt) => prompt,
    persistHarnessMemory: async () => {},
  });

  const response = await handler(
    buildSandboxRouteRequest({
      method: "POST",
      suffix: "/harness",
      init: {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ harness: "codex", prompt: "Fix checkout" }),
      },
    }),
    buildSandboxRouteParams()
  );
  const events = parseSseEvents(await response.text());

  assert.equal(publishCalled, false);
  assert.ok(events.some((event) => event.type === "cancelled"));
});

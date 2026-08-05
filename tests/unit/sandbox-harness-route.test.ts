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
  loadSandboxHarnessRouteModule,
} from "./sandbox-service-route-test-harness";
import {
  materializeSlackImageAttachmentsForHarness,
  normalizeSlackRunImageAttachmentsMetadata,
  type SlackRunImageAttachmentsMetadata,
} from "../../lib/slack/run-attachments";
import { isClosedSandboxStreamError } from "../../app/api/sandbox/[id]/harness/route";
import type { AiCall } from "../../lib/types";
import type { Sandbox } from "@vercel/sandbox";

function buildAiCall(overrides: Partial<AiCall> = {}): AiCall {
  return {
    id: "call-123",
    user_id: "user-123",
    type: "agent",
    model: "harness:codex",
    input_tokens: null,
    output_tokens: null,
    cache_read_input_tokens: null,
    cache_creation_input_tokens: null,
    reasoning_tokens: null,
    gateway_generation_id: null,
    cost_source: null,
    total_tokens: null,
    cost_usd: null,
    duration_ms: null,
    started_at: "2026-08-05T00:00:00.000Z",
    completed_at: null,
    status: "pending",
    error: null,
    conversation_id: null,
    job_run_id: null,
    repo_id: "repo-123",
    limit_claim_id: null,
    cancel_requested_at: null,
    control_state: "active",
    runtime_command_id: null,
    tool_calls_count: 0,
    tool_calls: [],
    metadata: {},
    ...overrides,
  };
}

function parseSseEvents(body: string) {
  return body
    .split("\n\n")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map(
      (entry) =>
        JSON.parse(entry.replace(/^data:\s*/, "")) as Record<string, unknown>
    );
}

function buildHarnessGitDeliveryDeps() {
  return {
    getGithubAccessTokenForRepo: async () => "github-token",
    resolveSandboxGitAuthor: async () => ({
      name: "Mogplex Agent",
      email: "agent@example.com",
    }),
    ensureDevTools: async () => ({ ok: true, logs: "" }),
    syncTerminalRuntimeAuth: async () => ({ ok: true, logs: "" }),
    syncHarnessGitWorkspace: async (
      _sandbox: Sandbox,
      input: { baseBranch: string; workingBranch: string }
    ) => ({
      baseBranch: input.baseBranch,
      workingBranch: input.workingBranch,
      createdBranch: false,
    }),
    publishHarnessPullRequest: async () => ({
      pullRequestUrl: null,
      changed: false,
      autoCommittedFiles: [],
    }),
    updateSandboxWorkingBranch: async () => {},
  };
}

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
    runHarness: async () =>
      ({
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
  let completionMetadata: Record<string, unknown> | undefined;
  let publishedPrompt: string | undefined;

  const handler = createSandboxHarnessPostHandler({
    ...buildHarnessGitDeliveryDeps(),
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
    runHarness: async () =>
      ({
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
  assert.equal(completionMetadata?.working_branch, "mogplex/test-branch");
  assert.deepEqual(completionMetadata?.auto_committed_files, [
    "components/checkout.tsx",
  ]);
  assert.equal(publishedPrompt, "Fix checkout");
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

test("POST /api/sandbox/[id]/harness prepares a cancellable call before starting the harness", async () => {
  const { createSandboxHarnessPostHandler } =
    await loadSandboxHarnessRouteModule();
  const aiCall = buildAiCall({ metadata: { source: "cli", prepared: true } });
  let runHarnessCalled = false;

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
    getSandbox: async () => ({}) as never,
    runHarness: async () => {
      runHarnessCalled = true;
      throw new Error("runHarness should not be called while preparing");
    },
    renewSandboxActivityLease: async () => 0,
    stopSandboxRecord: async () => null,
    touchSandboxLastActive: async () => {},
    resolveRepoSandboxEnv: async () => ({
      envVars: {},
      sync: { mode: "sandbox-only", source: "manual", warning: null },
    }),
    createAiCall: async (input) => {
      assert.equal(input.metadata?.prepared, true);
      return aiCall;
    },
    loadOwnedAiCall: async () => null,
    mergeAiCallMetadata: async () => {
      throw new Error("mergeAiCallMetadata should not be called");
    },
    updateAiCall: async () => {},
    finalizeAiCallAsCancelledIfActive: async () => null,
    finalizeAiCallIfNotCancelled: async () => null,
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
          prompt: "Review this repo",
          prepareOnly: true,
        }),
      },
    }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { aiCallId: aiCall.id });
  assert.equal(runHarnessCalled, false);
});

test("POST /api/sandbox/[id]/harness clears the prepared marker when claiming a call", async () => {
  const { createSandboxHarnessPostHandler } =
    await loadSandboxHarnessRouteModule();
  const aiCall = buildAiCall({
    metadata: {
      source: "cli",
      prepared: true,
      sandbox_record_id: "sandbox-1",
      harness_id: "codex",
    },
  });
  let mergedMetadata: Record<string, unknown> | null = null;

  const handler = createSandboxHarnessPostHandler({
    ...buildHarnessGitDeliveryDeps(),
    getSandboxServiceCredentials: async () => buildSandboxServiceRouteAuth(),
    loadOwnedSandboxRecord: async () =>
      buildOwnedSandboxServiceRecord({ record: { sandbox_id: "pending" } }),
    resolveSandboxAiAccess: async () =>
      buildSandboxServiceAiAccess({
        aiBillingSource: "user_ai_gateway",
        gatewayApiKey: "gateway-key",
      }),
    getSandbox: async () => {
      throw new Error("pending sandbox should not be loaded");
    },
    renewSandboxActivityLease: async () => 0,
    stopSandboxRecord: async () => null,
    touchSandboxLastActive: async () => {},
    resolveRepoSandboxEnv: async () => ({
      envVars: {},
      sync: { mode: "sandbox-only", source: "manual", warning: null },
    }),
    createAiCall: async () => {
      throw new Error("existing call should be claimed");
    },
    loadOwnedAiCall: async () => aiCall,
    mergeAiCallMetadata: async (input) => {
      mergedMetadata = input.metadata;
      return { ...aiCall, metadata: { ...aiCall.metadata, ...input.metadata } };
    },
    updateAiCall: async () => {},
    finalizeAiCallAsCancelledIfActive: async () => null,
    finalizeAiCallIfNotCancelled: async () => null,
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
          prompt: "Review this repo",
          aiCallId: aiCall.id,
        }),
      },
    }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 409);
  assert.equal(
    (mergedMetadata as Record<string, unknown> | null)?.prepared,
    false
  );
});

test("POST /api/sandbox/[id]/harness sanitizes a closed sandbox stream", async (t) => {
  const { createSandboxHarnessPostHandler } =
    await loadSandboxHarnessRouteModule();
  const aiCall = buildAiCall();
  const rawError = "Sandbox stream was closed: internal session vm-secret";
  let persistedError: string | null | undefined;
  let stoppedRecordId: string | null = null;
  const loggedErrors: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => {
    loggedErrors.push(args);
  });

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
    getSandbox: async () => ({}) as never,
    runHarness: async () =>
      ({
        installed: false,
        installLogs: "",
        command: {
          cmdId: "cmd-closed",
          async *logs() {
            yield { stream: "stdout" as const, data: "Starting agent\n" };
            throw new Error(rawError);
          },
          wait: async () => ({ exitCode: 1 }),
          kill: async () => {},
        },
      }) as never,
    renewSandboxActivityLease: async () => 0,
    stopSandboxRecord: async (recordId) => {
      stoppedRecordId = recordId;
      return null;
    },
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
        body: JSON.stringify({ harness: "codex", prompt: "Review this repo" }),
      },
    }),
    buildSandboxRouteParams()
  );

  const events = parseSseEvents(await response.text());
  const errorEvent = events.find((event) => event.type === "error");
  const friendlyError =
    "The development environment stopped during this agent run. Start it again, then retry.";
  assert.equal(stoppedRecordId, "sandbox-1");
  assert.equal(persistedError, friendlyError);
  assert.deepEqual(errorEvent, { type: "error", data: friendlyError });
  assert.doesNotMatch(JSON.stringify(events), /vm-secret/);
  assert.equal(
    loggedErrors.some((args) => JSON.stringify(args).includes(rawError)),
    true
  );
});

test("POST /api/sandbox/[id]/harness fails clearly when neither gateway nor provider credentials exist", async () => {
  const { createSandboxHarnessPostHandler } =
    await loadSandboxHarnessRouteModule();

  const handler = createSandboxHarnessPostHandler({
    getSandboxServiceCredentials: async () => buildSandboxServiceRouteAuth(),
    loadOwnedSandboxRecord: async () => buildOwnedSandboxServiceRecord(),
    resolveSandboxAiAccess: async () => buildSandboxServiceAiAccess(),
    getSandbox: async () => {
      throw new Error("getSandbox should not be called");
    },
    runHarness: async () => {
      throw new Error("runHarness should not be called");
    },
  });

  const response = await handler(
    buildSandboxRouteRequest({
      method: "POST",
      suffix: "/harness",
      init: {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          harness: "claude-code",
          prompt: "Review this repo",
        }),
      },
    }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    error:
      "No Anthropic API key configured. Add one in Settings > API Keys or configure an AI Gateway key.",
  });
});

test("materializeSlackImageAttachmentsForHarness writes Slack images into the sandbox", async () => {
  const writes: Array<{ path: string; content: Buffer }> = [];
  const result = await materializeSlackImageAttachmentsForHarness({
    deps: {
      getSlackBotToken: async (teamId) => {
        assert.equal(teamId, "T1");
        return "xoxb-test";
      },
      fetchSlackAttachment: async (input) => {
        assert.equal(input.botToken, "xoxb-test");
        assert.equal(input.url, "https://files.slack.com/files-pri/T-F1/png");
        assert.equal(input.signal.aborted, false);
        return new Response(Buffer.from("image-bytes"), {
          headers: { "content-length": "11" },
        });
      },
    },
    sandbox: {
      async readFile() {
        throw new Error("missing");
      },
      async writeFiles(entries) {
        writes.push(...entries);
      },
    },
    rootDirectory: "apps/web",
    attachments: {
      teamId: "T1",
      files: [
        {
          id: "F1",
          mimetype: "image/png",
          urlPrivateDownload: "https://files.slack.com/files-pri/T-F1/png",
          name: "screen shot.png",
          sizeBytes: 11,
        },
      ],
    },
  });

  assert.deepEqual(
    writes.map((write) => write.path),
    [
      "apps/web/.mogplex/.gitignore",
      "apps/web/.mogplex/slack-attachments/01-screen_shot.png",
    ]
  );
  assert.equal(writes[0]?.content.toString(), "*\n");
  assert.equal(writes[1]?.content.toString(), "image-bytes");
  assert.equal(
    result.writtenFiles[0]?.path,
    ".mogplex/slack-attachments/01-screen_shot.png"
  );
  assert.match(
    result.promptSection ?? "",
    /\.mogplex\/slack-attachments\/01-screen_shot\.png/
  );
});

test("normalizeSlackRunImageAttachmentsMetadata accepts slack.com download URLs", () => {
  const metadata = normalizeSlackRunImageAttachmentsMetadata({
    teamId: "T1",
    files: [
      {
        id: "F1",
        mimetype: "image/png",
        urlPrivateDownload:
          "https://slack.com/files-pri/T024BE7LD-F024BERPE/download/1.png",
      },
    ],
  });

  assert.deepEqual(metadata, {
    teamId: "T1",
    files: [
      {
        id: "F1",
        mimetype: "image/png",
        urlPrivateDownload:
          "https://slack.com/files-pri/T024BE7LD-F024BERPE/download/1.png",
      },
    ],
  });
});

test("normalizeSlackRunImageAttachmentsMetadata rejects non-Slack download URLs", (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const metadata = normalizeSlackRunImageAttachmentsMetadata({
    teamId: "T1",
    files: [
      {
        id: "F1",
        mimetype: "image/png",
        urlPrivateDownload: "https://example.com/steal-token",
      },
    ],
  });

  assert.equal(metadata, null);
  assert.equal(warn.mock.callCount(), 1);
  assert.equal(
    warn.mock.calls[0]?.arguments[0],
    "[slack-run-attachments] dropped all Slack image attachments metadata"
  );
  assert.deepEqual(warn.mock.calls[0]?.arguments[1], { fileCount: 1 });
});

test("materializeSlackImageAttachmentsForHarness treats missing Slack tokens as unavailable", async (t) => {
  const writes: Array<{ path: string; content: Buffer }> = [];
  const warn = t.mock.method(console, "warn", () => {});
  const attachments = {
    teamId: "T1",
    files: [
      {
        id: "F1",
        mimetype: "image/png",
        urlPrivateDownload: "https://files.slack.com/files-pri/T-F1/png",
        sizeBytes: 11,
      },
      {
        id: "F2",
        mimetype: "image/jpeg",
        urlPrivateDownload: "https://files.slack.com/files-pri/T-F2/jpg",
        sizeBytes: 12,
      },
    ],
  } satisfies SlackRunImageAttachmentsMetadata;
  const result = await materializeSlackImageAttachmentsForHarness({
    deps: {
      getSlackBotToken: async () => {
        throw new Error("vault unavailable");
      },
      fetchSlackAttachment: async () => {
        throw new Error("should not fetch without a token");
      },
    },
    sandbox: {
      async readFile() {
        throw new Error("should not read when token is unavailable");
      },
      async writeFiles(entries) {
        writes.push(...entries);
      },
    },
    rootDirectory: "apps/web",
    attachments,
  });

  assert.deepEqual(writes, []);
  assert.deepEqual(result.writtenFiles, []);
  assert.equal(result.droppedCount, 0);
  assert.equal(result.unavailableCount, attachments.files.length);
  assert.match(result.promptSection ?? "", /could not save any/);
  assert.match(
    result.promptSection ?? "",
    /2 Slack image attachment\(s\) could not be downloaded/
  );
  assert.equal(warn.mock.callCount(), 1);
  assert.equal(
    warn.mock.calls[0]?.arguments[0],
    "[harness] failed to load Slack bot token for attachments"
  );
  assert.deepEqual(warn.mock.calls[0]?.arguments[1], {
    teamId: "T1",
    error: { name: "Error", message: "vault unavailable" },
  });
});

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
import {
  buildAiCall,
  parseSseEvents,
  buildHarnessGitDeliveryDeps,
  loadSandboxHarnessRouteModule,
} from "./helpers/sandbox-harness-route-fixtures";

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

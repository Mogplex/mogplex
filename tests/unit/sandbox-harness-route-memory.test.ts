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
  buildHarnessGitDeliveryDeps,
  loadSandboxHarnessRouteModule,
} from "./helpers/sandbox-harness-route-fixtures";

test("POST /api/sandbox/[id]/harness records an episodic outcome but never the task prompt as a session memory", async () => {
  const { createSandboxHarnessPostHandler } =
    await loadSandboxHarnessRouteModule();
  const aiCall = buildAiCall();
  const persisted: Array<{ lane: string; content: string }> = [];
  const prompt =
    "You are Codex running a Mogplex automation inside an isolated checkout. Review this repo.";

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
          cmdId: "cmd-memory",
          async *logs() {
            yield { stream: "stdout" as const, data: "done\n" };
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
    finalizeAiCallIfNotCancelled: async (_aiCallId, update) =>
      buildAiCall({
        status: update.status ?? "success",
        error: update.error ?? null,
      }),
    safeAppendAiCallEvent: async () => null,
    loadHarnessPromptWithMemoryContext: async (_userId, text) => text,
    persistHarnessMemory: async (input) => {
      persisted.push({ lane: input.lane, content: input.content });
    },
  });

  const response = await handler(
    buildSandboxRouteRequest({
      method: "POST",
      suffix: "/harness",
      init: {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ harness: "codex", prompt }),
      },
    }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 200);
  await response.text();
  // The persist is fire-and-forget; let any pending write settle.
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(
    persisted.filter((entry) => entry.lane === "session"),
    [],
    "the task prompt is run input, not a memory"
  );
  const outcomes = persisted.filter((entry) => entry.lane === "episodic");
  assert.equal(outcomes.length, 1);
  assert.ok(outcomes[0].content.startsWith("codex: "));
  assert.ok(outcomes[0].content.length <= 200);
});

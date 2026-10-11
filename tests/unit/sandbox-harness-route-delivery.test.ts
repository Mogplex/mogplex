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
  parseSseEvents,
} from "./helpers/sandbox-harness-route-fixtures";

type Observed = {
  prompt: string;
  delivery: string | undefined;
  events: string[];
};

async function runHarnessRoute(body: Record<string, unknown>) {
  const { createSandboxHarnessPostHandler } =
    await loadSandboxHarnessRouteModule();
  const aiCall = buildAiCall();
  const observed: Observed = { prompt: "", delivery: undefined, events: [] };
  const handler = createSandboxHarnessPostHandler({
    ...buildHarnessGitDeliveryDeps(),
    publishHarnessPullRequest: async (_sandbox, input) => {
      observed.delivery = input.delivery;
      return { pullRequestUrl: null, changed: true, autoCommittedFiles: [] };
    },
    getSandboxServiceCredentials: async () => buildSandboxServiceRouteAuth(),
    loadOwnedSandboxRecord: async () =>
      buildOwnedSandboxServiceRecord({
        record: { working_branch: "mogplex/automation-0123456789abcdef" },
        repo: buildSandboxServiceRecordRepo({ github_installation_id: 123 }),
      }),
    resolveSandboxAiAccess: async () =>
      buildSandboxServiceAiAccess({
        aiBillingSource: "user_ai_gateway",
        gatewayApiKey: "gateway-key",
      }),
    getSandbox: async () => ({}) as never,
    runHarness: async (_sandbox, _harness, prompt) => {
      observed.prompt = prompt;
      return {
        installed: false,
        installLogs: "",
        command: {
          cmdId: "cmd-delivery",
          async *logs() {
            yield { stream: "stdout" as const, data: "done\n" };
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
    finalizeAiCallIfNotCancelled: async (_aiCallId, update) =>
      buildAiCall({ status: "success", metadata: update.metadata }),
    safeAppendAiCallEvent: async (event) => {
      observed.events.push(event.message ?? "");
      return null;
    },
    loadHarnessPromptWithMemoryContext: async (_userId, prompt) => prompt,
    persistHarnessMemory: async () => {},
  });

  const response = await handler(
    buildSandboxRouteRequest({
      method: "POST",
      suffix: "/harness",
      init: {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ harness: "codex", prompt: "Build", ...body }),
      },
    }),
    buildSandboxRouteParams()
  );
  assert.equal(response.status, 200);
  const done = parseSseEvents(await response.text()).find(
    (event) => event.type === "done"
  );
  assert.equal(done?.exitCode, 0);
  return observed;
}

test("POST /api/sandbox/[id]/harness delivers to the branch when the caller asks", async () => {
  const observed = await runHarnessRoute({ delivery: "branch" });

  assert.equal(observed.delivery, "branch");
  assert.match(
    observed.prompt,
    /Open a pull request only if your instructions ask/
  );
  assert.ok(
    observed.events.includes("Pushed mogplex/automation-0123456789abcdef")
  );
});

test("POST /api/sandbox/[id]/harness opens a pull request by default", async () => {
  for (const body of [{}, { delivery: "something-else" }]) {
    const observed = await runHarnessRoute(body);
    assert.equal(observed.delivery, "pull_request");
    assert.match(observed.prompt, /Open or update a pull request into main/);
  }
});

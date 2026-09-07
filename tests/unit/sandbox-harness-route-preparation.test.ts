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

for (const providerStatus of [
  "running",
  "stopped",
  "unavailable",
  "ambiguous-404",
  "unrelated-not-found",
  "command-unconfirmed",
  "command-pending",
] as const) {
  test(`POST /api/sandbox/[id]/harness reconciles a closed stream when provider is ${providerStatus}`, async (t) => {
    const { createSandboxHarnessPostHandler } =
      await loadSandboxHarnessRouteModule();
    const aiCall = buildAiCall();
    const rawError = "Sandbox stream was closed: internal session vm-secret";
    let persistedError: string | null | undefined;
    let stoppedRecordId: string | null = null;
    const lifecycleEvents: Array<Record<string, unknown>> = [];
    const commandLifecycle: string[] = [];
    let terminationWaitAborted = false;
    let terminationDeadlineMs = 0;
    const terminationController = new AbortController();
    if (providerStatus === "command-pending")
      t.mock.method(AbortSignal, "timeout", (ms: number) => {
        terminationDeadlineMs = ms;
        return terminationController.signal;
      });
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
      getSandbox: async (_name, _credentials, options) => {
        if (options?.resume === false && providerStatus === "unavailable")
          throw new Error("Provider unavailable");
        if (options?.resume === false && providerStatus === "ambiguous-404")
          throw Object.assign(new Error("Project lookup returned 404"), {
            status: 404,
          });
        if (
          options?.resume === false &&
          providerStatus === "unrelated-not-found"
        )
          throw new Error("Credential scope not found");
        return {
          status: providerStatus === "stopped" ? "stopped" : "running",
        } as never;
      },
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
            wait: async (options?: { signal?: AbortSignal }) => {
              if (providerStatus === "command-pending") {
                commandLifecycle.push("wait-unconfirmed");
                assert.ok(
                  options?.signal,
                  "termination confirmation must have a deadline"
                );
                return new Promise((_, reject) => {
                  options.signal!.addEventListener(
                    "abort",
                    () => {
                      terminationWaitAborted = true;
                      reject(new Error("Termination confirmation expired"));
                    },
                    { once: true }
                  );
                  queueMicrotask(() => terminationController.abort());
                });
              }
              if (providerStatus === "command-unconfirmed") {
                commandLifecycle.push("wait-unconfirmed");
                throw new Error("Cannot confirm completion");
              }
              commandLifecycle.push("confirmed-stopped");
              return { exitCode: 137 };
            },
            kill: async () => {
              commandLifecycle.push("kill");
              if (
                providerStatus === "command-unconfirmed" ||
                providerStatus === "command-pending"
              )
                throw new Error("Command connection unavailable");
            },
          },
        }) as never,
      renewSandboxActivityLease: async () => 0,
      stopSandboxRecord: async (recordId) => {
        stoppedRecordId = recordId;
        return null;
      },
      recordSandboxLifecycleEvent: async (event) => {
        lifecycleEvents.push(event);
        return "event-1";
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
        commandLifecycle.push("finalize");
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
          body: JSON.stringify({
            harness: "codex",
            prompt: "Review this repo",
          }),
        },
      }),
      buildSandboxRouteParams()
    );

    const events = parseSseEvents(await response.text());
    const errorEvent = events.find((event) => event.type === "error");
    const friendlyError =
      providerStatus === "stopped"
        ? "The development environment stopped during this agent run. Start it again, then retry."
        : providerStatus === "command-unconfirmed" ||
            providerStatus === "command-pending"
          ? "The worker lost its command connection and its command may still be running. Confirm it has stopped before retrying."
          : "The worker lost its command connection. Its command was stopped; inspect its saved output before retrying.";
    assert.equal(
      stoppedRecordId,
      providerStatus === "stopped" ? "sandbox-1" : null
    );
    // A vanished VM must leave a row a human can find later; mission
    // 43f98333 had to be reconstructed from three other systems.
    assert.deepEqual(
      lifecycleEvents,
      providerStatus === "stopped"
        ? [
            {
              sandboxRecordId: "sandbox-1",
              userId: aiCall.user_id,
              eventType: "worker_vm_gone",
              workerRunId: aiCall.id,
              payload: {
                sandbox_id: "sandbox-runtime-123",
                provider_status: "stopped",
                harness: "codex",
                runtime_command_id: "cmd-closed",
                conversation_id: aiCall.conversation_id ?? null,
              },
            },
          ]
        : []
    );
    assert.deepEqual(
      commandLifecycle,
      providerStatus === "stopped"
        ? ["finalize"]
        : providerStatus === "command-unconfirmed" ||
            providerStatus === "command-pending"
          ? ["kill", "wait-unconfirmed", "finalize"]
          : ["kill", "confirmed-stopped", "finalize"]
    );
    if (providerStatus === "command-pending") {
      assert.equal(terminationWaitAborted, true);
      assert.ok(terminationDeadlineMs > 0 && terminationDeadlineMs <= 10_000);
    }
    assert.equal(persistedError, friendlyError);
    assert.deepEqual(errorEvent, { type: "error", data: friendlyError });
    assert.doesNotMatch(JSON.stringify(events), /vm-secret/);
    assert.equal(
      loggedErrors.some((args) => JSON.stringify(args).includes(rawError)),
      true
    );
  });
}

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

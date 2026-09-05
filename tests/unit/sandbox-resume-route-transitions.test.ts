import assert from "node:assert/strict";
import test from "node:test";
import { loadSandboxResumeRouteModule } from "./sandbox-record-route-test-harness/loaders";
import {
  buildSandboxRouteParams,
  buildSandboxRouteRequest,
  readStreamBody,
} from "./sandbox-record-route-test-harness";
import {
  type ResumeRecord,
  buildLoadedResumeContext,
  buildPersistedResumeRecord,
} from "./helpers/sandbox-resume-route-fixtures";

test("POST /api/sandbox/[id]/resume transitions paused -> installing and streams a 'ready' event when bootstrap reports running", async () => {
  const { createSandboxResumeHandler } = await loadSandboxResumeRouteModule();
  const updateCalls: Array<Record<string, unknown>> = [];
  const resumeRootDirectory = "apps/web";
  const resumeTerminalCwd = "/workspace/apps/web";
  const resumeStartedAt = Date.now();

  const handler = createSandboxResumeHandler({
    loadOwnedSandboxRouteContext: (async () =>
      buildLoadedResumeContext({
        root_directory: resumeRootDirectory,
        terminal_cwd: resumeTerminalCwd,
      })) as never,
    enforceSandboxBootLimits: (async () => ({
      allowed: true,
      claimId: "claim-resume-1",
    })) as never,
    getSandbox: (async () => ({}) as never) as never,
    updateSandboxRecord: (async (
      _id: string,
      updates: Record<string, unknown>
    ) => {
      updateCalls.push(updates);
      return buildPersistedResumeRecord({
        root_directory: resumeRootDirectory,
        terminal_cwd: resumeTerminalCwd,
        ...(updates as Partial<ResumeRecord>),
      });
    }) as never,
    resolveRepoSandboxEnv: (async () => ({
      envVars: {},
      sync: { mode: "sandbox-only" },
    })) as never,
    bootstrapFromSnapshotStreaming: async function* bootstrapMock() {
      yield { type: "preview_url", url: "https://preview.example.com" };
      yield { type: "status", status: "running" };
    } as never,
  });

  const response = await handler(
    buildSandboxRouteRequest({ method: "POST", suffix: "/resume" }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "text/event-stream");

  // Drain the SSE stream to confirm ready fires and paused->installing
  // transition is written before bootstrap events.
  const body = await readStreamBody(response);

  assert.match(body, /"type":"sandbox_created"/);
  assert.match(body, /"type":"preview_url"/);
  assert.match(body, /"type":"status","status":"running"/);
  assert.match(body, /"type":"ready"/);
  assert.match(body, /"root_directory":"apps\/web"/);
  assert.match(body, /"terminal_cwd":"\/workspace\/apps\/web"/);

  // First update flips paused -> installing, last one flips to running.
  assert.ok(
    updateCalls.some(
      (u) =>
        u.status === "installing" &&
        u.health_status === "starting" &&
        u.limit_claim_id === "claim-resume-1"
    ),
    "expected a paused->installing update call"
  );
  assert.ok(
    updateCalls.some(
      (u) => u.status === "running" && u.health_status === "running"
    ),
    "expected an installing->running update call"
  );
  const bootStart = Date.parse(String(updateCalls[0].last_boot_started_at));
  assert.ok(bootStart >= resumeStartedAt && bootStart <= Date.now());
  assert.equal(updateCalls[0].last_boot_completed_at, null);
});

test("POST /api/sandbox/[id]/resume records resume_after_auto_pause metric", async () => {
  const { createSandboxResumeHandler } = await loadSandboxResumeRouteModule();
  const lifecycleEvents: Array<{
    eventType: string;
    sandboxRecordId: string | null;
    userId: string | null;
    payload?: Record<string, unknown>;
  }> = [];

  const handler = createSandboxResumeHandler({
    loadOwnedSandboxRouteContext: (async () =>
      buildLoadedResumeContext({
        stop_reason: "auto_pause",
        last_active_at: "2026-05-20T11:58:00.000Z",
      })) as never,
    enforceSandboxBootLimits: (async () => ({
      allowed: true,
      claimId: "claim-resume-1",
    })) as never,
    getSandbox: (async () => ({}) as never) as never,
    updateSandboxRecord: (async (
      _id: string,
      updates: Record<string, unknown>
    ) => buildPersistedResumeRecord(updates as Partial<ResumeRecord>)) as never,
    resolveRepoSandboxEnv: (async () => ({
      envVars: {},
      sync: { mode: "sandbox-only" },
    })) as never,
    bootstrapFromSnapshotStreaming: async function* bootstrapMock() {
      yield { type: "status", status: "running" };
    } as never,
    recordSandboxLifecycleEvent: async (event) => {
      lifecycleEvents.push(event as never);
      return "event-resume-auto-pause";
    },
  });

  const response = await handler(
    buildSandboxRouteRequest({ method: "POST", suffix: "/resume" }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 200);
  await readStreamBody(response);
  assert.equal(lifecycleEvents.length, 1);
  assert.equal(lifecycleEvents[0].eventType, "resume_after_auto_pause");
  assert.equal(lifecycleEvents[0].sandboxRecordId, "sandbox-1");
  assert.equal(lifecycleEvents[0].userId, "user-1");
  assert.equal(lifecycleEvents[0].payload?.sandbox_id, "vm_123");
  assert.equal(typeof lifecycleEvents[0].payload?.pause_duration_ms, "number");
});

test("POST /api/sandbox/[id]/resume emits cancelled when paused -> installing CAS fails", async () => {
  const { createSandboxResumeHandler } = await loadSandboxResumeRouteModule();
  const releasedClaims: string[] = [];
  let resolvedEnv = false;
  let bootstrapped = false;
  let stopCalls = 0;

  const handler = createSandboxResumeHandler({
    loadOwnedSandboxRouteContext: (async () =>
      buildLoadedResumeContext()) as never,
    enforceSandboxBootLimits: (async () => ({
      allowed: true,
      claimId: "claim-resume-1",
    })) as never,
    releaseLimitClaim: (async (input: { claimId: string }) => {
      releasedClaims.push(input.claimId);
      return true;
    }) as never,
    getSandbox: (async () =>
      ({
        stop: async () => {
          stopCalls += 1;
        },
      }) as never) as never,
    updateSandboxRecord: async () => null,
    resolveRepoSandboxEnv: (async () => {
      resolvedEnv = true;
      return { envVars: {}, sync: { mode: "sandbox-only" } };
    }) as never,
    bootstrapFromSnapshotStreaming: async function* bootstrapMock() {
      bootstrapped = true;
      yield { type: "status", status: "running" };
    } as never,
  });

  const response = await handler(
    buildSandboxRouteRequest({ method: "POST", suffix: "/resume" }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 409);
  const body = await readStreamBody(response);
  assert.match(body, /"type":"cancelled"/);
  assert.match(body, /"reason":"conflict"/);
  assert.equal(resolvedEnv, false);
  assert.equal(bootstrapped, false);
  assert.equal(stopCalls, 1);
  assert.deepEqual(releasedClaims, ["claim-resume-1"]);
});

test("POST /api/sandbox/[id]/resume emits cancelled and not ready when installing -> running CAS fails", async () => {
  const { createSandboxResumeHandler } = await loadSandboxResumeRouteModule();
  let stopCalls = 0;

  const handler = createSandboxResumeHandler({
    loadOwnedSandboxRouteContext: (async () =>
      buildLoadedResumeContext()) as never,
    enforceSandboxBootLimits: (async () => ({
      allowed: true,
      claimId: "claim-resume-1",
    })) as never,
    getSandbox: (async () =>
      ({
        stop: async () => {
          stopCalls += 1;
        },
      }) as never) as never,
    updateSandboxRecord: (async (
      _id: string,
      updates: Record<string, unknown>
    ) => {
      if ((updates as { status?: string }).status === "running") {
        return null;
      }
      return buildPersistedResumeRecord(updates as Partial<ResumeRecord>);
    }) as never,
    resolveRepoSandboxEnv: (async () => ({
      envVars: {},
      sync: { mode: "sandbox-only" },
    })) as never,
    bootstrapFromSnapshotStreaming: async function* bootstrapMock() {
      yield { type: "status", status: "running" };
    } as never,
  });

  const response = await handler(
    buildSandboxRouteRequest({ method: "POST", suffix: "/resume" }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 200);
  const body = await readStreamBody(response);
  assert.match(body, /"type":"cancelled"/);
  assert.doesNotMatch(body, /"type":"ready"/);
  assert.equal(stopCalls, 1);
});

test("POST /api/sandbox/[id]/resume emits cancelled and not ready when preview_url CAS fails", async () => {
  const { createSandboxResumeHandler } = await loadSandboxResumeRouteModule();
  let stopCalls = 0;

  const handler = createSandboxResumeHandler({
    loadOwnedSandboxRouteContext: (async () =>
      buildLoadedResumeContext()) as never,
    enforceSandboxBootLimits: (async () => ({
      allowed: true,
      claimId: "claim-resume-1",
    })) as never,
    getSandbox: (async () =>
      ({
        stop: async () => {
          stopCalls += 1;
        },
      }) as never) as never,
    updateSandboxRecord: (async (
      _id: string,
      updates: Record<string, unknown>
    ) => {
      if ("preview_url" in updates) {
        return null;
      }
      return buildPersistedResumeRecord(updates as Partial<ResumeRecord>);
    }) as never,
    resolveRepoSandboxEnv: (async () => ({
      envVars: {},
      sync: { mode: "sandbox-only" },
    })) as never,
    bootstrapFromSnapshotStreaming: async function* bootstrapMock() {
      yield { type: "preview_url", url: "https://preview.example.com" };
      yield { type: "status", status: "running" };
    } as never,
  });

  const response = await handler(
    buildSandboxRouteRequest({ method: "POST", suffix: "/resume" }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 200);
  const body = await readStreamBody(response);
  assert.match(body, /"type":"cancelled"/);
  assert.doesNotMatch(body, /"type":"preview_url"/);
  assert.doesNotMatch(body, /"type":"ready"/);
  assert.equal(stopCalls, 1);
});

test("POST /api/sandbox/[id]/resume guards bootstrap error writes after late stop/delete", async () => {
  const { createSandboxResumeHandler } = await loadSandboxResumeRouteModule();
  const updateCalls: Array<{
    updates: Record<string, unknown>;
    options: Record<string, unknown> | undefined;
  }> = [];
  let providerStops = 0;
  let billingFinalizations = 0;

  const handler = createSandboxResumeHandler({
    loadOwnedSandboxRouteContext: (async () =>
      buildLoadedResumeContext()) as never,
    enforceSandboxBootLimits: (async () => ({
      allowed: true,
      claimId: "claim-resume-1",
    })) as never,
    releaseLimitClaim: (async () => {
      throw new Error("bootstrap errors should preserve consumed claims");
    }) as never,
    getSandbox: (async () =>
      ({
        stop: async () => {
          providerStops += 1;
        },
        currentSession: () => ({
          stoppedAt: new Date("2026-08-05T11:10:00.000Z"),
        }),
      }) as never) as never,
    prepareSandboxBillingClose: async () => ({
      sessionId: "billing-session-1",
      closeGeneration: 1,
      actorUserId: "user-1",
    }),
    finalizeSandboxBillingClose: async () => {
      billingFinalizations += 1;
      return { finalized: true, metered: true };
    },
    updateSandboxRecord: (async (
      _id: string,
      updates: Record<string, unknown>,
      options: Record<string, unknown> | undefined
    ) => {
      updateCalls.push({ updates, options });
      if ((updates as { status?: string }).status === "error") {
        return null;
      }
      return buildPersistedResumeRecord(updates as Partial<ResumeRecord>);
    }) as never,
    resolveRepoSandboxEnv: (async () => ({
      envVars: {},
      sync: { mode: "sandbox-only" },
    })) as never,
    bootstrapFromSnapshotStreaming: async function* bootstrapMock() {
      yield* [] as Array<{ type: "status"; status: "running" }>;
      throw new Error("dev server failed");
    } as never,
  });

  const response = await handler(
    buildSandboxRouteRequest({ method: "POST", suffix: "/resume" }),
    buildSandboxRouteParams()
  );

  const body = await readStreamBody(response);
  const errorWrite = updateCalls.find(
    (call) => call.updates.status === "error"
  );
  assert.deepEqual(errorWrite?.options, {
    expectedSandboxId: "vm_123",
    fromStatuses: ["installing", "running"],
  });
  assert.match(body, /"type":"cancelled"/);
  assert.doesNotMatch(body, /"type":"error"/);
  assert.equal(providerStops, 1);
  assert.equal(billingFinalizations, 1);
});

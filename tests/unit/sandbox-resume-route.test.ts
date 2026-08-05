import assert from "node:assert/strict";
import test from "node:test";
import { loadSandboxResumeRouteModule } from "./sandbox-record-route-test-harness/loaders";
import {
  buildSandboxRouteContextFailure,
  buildSandboxRouteParams,
  buildSandboxRouteRequest,
  readStreamBody,
} from "./sandbox-record-route-test-harness";
import { defaultSandboxAuth } from "./sandbox-record-route-test-harness/shared";

type ResumeRecord = {
  id: string;
  user_id: string;
  repo_id: string;
  sandbox_id: string;
  base_branch: string | null;
  working_branch: string | null;
  status: string;
  stop_reason: string | null;
  health_status: string | null;
  preview_url: string | null;
  snapshot_id: string | null;
  runtime: string | null;
  terminal_cwd: string | null;
  root_directory: string | null;
  persistent: boolean | null;
  created_at: string;
  last_active_at: string | null;
  repo: unknown;
};

function buildLoadedResumeContext(overrides: Partial<ResumeRecord> = {}) {
  return {
    ok: true as const,
    auth: { ...defaultSandboxAuth },
    repo: null,
    rootDirectory: undefined,
    context: {
      credentials: {
        vercelToken: "platform-token",
        vercelTeamId: null,
        vercelProjectId: "project-1",
      },
    },
    sandbox: null,
    record: {
      id: "sandbox-1",
      user_id: "user-1",
      repo_id: "repo-1",
      sandbox_id: "vm_123",
      base_branch: "main",
      working_branch: "feature-a",
      status: "paused",
      stop_reason: null,
      health_status: "paused",
      preview_url: "https://preview.example.com",
      snapshot_id: "snap_abc",
      runtime: "node22",
      terminal_cwd: null,
      root_directory: null,
      persistent: true,
      created_at: "2026-04-01T10:00:00.000Z",
      last_active_at: "2026-04-01T10:00:00.000Z",
      repo: {
        id: "repo-1",
        root_directory: null,
        dev_command: null,
        dev_port: 3000,
        dev_port_auto: true,
        runtime: "node22",
        sandbox_env_vars: null,
        env_sync_mode: "sandbox-only",
        vercel_project_id: "project-1",
        vercel_team_id: null,
      },
      ...overrides,
    },
  };
}

function buildPersistedResumeRecord(
  updates: Partial<ResumeRecord> = {}
): ResumeRecord {
  return {
    ...buildLoadedResumeContext().record,
    ...updates,
  };
}

test("POST /api/sandbox/[id]/resume rejects non-paused sandboxes", async () => {
  const { createSandboxResumeHandler } = await loadSandboxResumeRouteModule();

  const handler = createSandboxResumeHandler({
    loadOwnedSandboxRouteContext: (async () =>
      buildLoadedResumeContext({ status: "running" })) as never,
  });

  const response = await handler(
    buildSandboxRouteRequest({ method: "POST", suffix: "/resume" }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.match(payload.error, /not paused/i);
});

test("POST /api/sandbox/[id]/resume rejects pausing sandboxes with a conflict before waking the VM", async () => {
  const { createSandboxResumeHandler } = await loadSandboxResumeRouteModule();
  let getSandboxCalls = 0;

  const handler = createSandboxResumeHandler({
    loadOwnedSandboxRouteContext: (async () =>
      buildLoadedResumeContext({
        status: "pausing",
        health_status: "pausing",
      })) as never,
    getSandbox: async () => {
      getSandboxCalls += 1;
      return {} as never;
    },
  });

  const response = await handler(
    buildSandboxRouteRequest({ method: "POST", suffix: "/resume" }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 409);
  const payload = await response.json();
  assert.match(payload.error, /paus/i);
  assert.equal(getSandboxCalls, 0);
});

test("POST /api/sandbox/[id]/resume rejects non-persistent paused records", async () => {
  const { createSandboxResumeHandler } = await loadSandboxResumeRouteModule();

  const handler = createSandboxResumeHandler({
    loadOwnedSandboxRouteContext: (async () =>
      buildLoadedResumeContext({ persistent: false })) as never,
  });

  const response = await handler(
    buildSandboxRouteRequest({ method: "POST", suffix: "/resume" }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.match(payload.error, /not persistent/i);
});

test("POST /api/sandbox/[id]/resume rejects records still booting", async () => {
  const { createSandboxResumeHandler } = await loadSandboxResumeRouteModule();

  const handler = createSandboxResumeHandler({
    loadOwnedSandboxRouteContext: (async () =>
      buildLoadedResumeContext({ sandbox_id: "pending" })) as never,
  });

  const response = await handler(
    buildSandboxRouteRequest({ method: "POST", suffix: "/resume" }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 409);
});

test("POST /api/sandbox/[id]/resume forwards route-context failures", async () => {
  const { createSandboxResumeHandler } = await loadSandboxResumeRouteModule();

  const handler = createSandboxResumeHandler({
    loadOwnedSandboxRouteContext: (async () =>
      buildSandboxRouteContextFailure({
        status: 401,
        error: "Unauthorized",
      })) as never,
  });

  const response = await handler(
    buildSandboxRouteRequest({ method: "POST", suffix: "/resume" }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 401);
});

test("POST /api/sandbox/[id]/resume denies active-limit conflicts before waking the VM", async () => {
  const { createSandboxResumeHandler } = await loadSandboxResumeRouteModule();
  let getSandboxCalls = 0;

  const handler = createSandboxResumeHandler({
    loadOwnedSandboxRouteContext: (async () =>
      buildLoadedResumeContext()) as never,
    enforceSandboxBootLimits: (async () => ({
      allowed: false,
      status: 429,
      code: "sandbox_boot_rate_limited",
      error: "Too many active sandboxes",
      reason: "active_sandbox_limit_exceeded",
      retryAfterSeconds: 15,
      limit: {
        name: "active_sandboxes",
        value: 3,
        windowSeconds: 0,
      },
    })) as never,
    getSandbox: async () => {
      getSandboxCalls += 1;
      return {} as never;
    },
  });

  const response = await handler(
    buildSandboxRouteRequest({ method: "POST", suffix: "/resume" }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "15");
  assert.equal(getSandboxCalls, 0);
});

test("POST /api/sandbox/[id]/resume returns 502 when Sandbox.get throws", async () => {
  const { createSandboxResumeHandler } = await loadSandboxResumeRouteModule();
  const releasedClaims: string[] = [];

  const handler = createSandboxResumeHandler({
    loadOwnedSandboxRouteContext: (async () =>
      buildLoadedResumeContext()) as never,
    enforceSandboxBootLimits: (async () => ({
      allowed: true,
      claimId: "claim-resume-1",
    })) as never,
    getSandbox: async () => {
      throw new Error("vm unavailable");
    },
    releaseLimitClaim: (async (input: { claimId: string }) => {
      releasedClaims.push(input.claimId);
      return true;
    }) as never,
  });

  const response = await handler(
    buildSandboxRouteRequest({ method: "POST", suffix: "/resume" }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 502);
  const payload = await response.json();
  assert.match(payload.error, /vm unavailable/);
  assert.deepEqual(releasedClaims, ["claim-resume-1"]);
});

test("POST /api/sandbox/[id]/resume transitions paused → installing and streams a 'ready' event when bootstrap reports running", async () => {
  const { createSandboxResumeHandler } = await loadSandboxResumeRouteModule();
  const updateCalls: Array<Record<string, unknown>> = [];
  const resumeRootDirectory = "apps/web";
  const resumeTerminalCwd = "/workspace/apps/web";

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

  // Drain the SSE stream to confirm ready fires and paused→installing
  // transition is written before bootstrap events.
  const body = await readStreamBody(response);

  assert.match(body, /"type":"sandbox_created"/);
  assert.match(body, /"type":"preview_url"/);
  assert.match(body, /"type":"status","status":"running"/);
  assert.match(body, /"type":"ready"/);
  assert.match(body, /"root_directory":"apps\/web"/);
  assert.match(body, /"terminal_cwd":"\/workspace\/apps\/web"/);

  // First update flips paused → installing, last one flips to running.
  assert.ok(
    updateCalls.some(
      (u) =>
        u.status === "installing" &&
        u.health_status === "starting" &&
        u.limit_claim_id === "claim-resume-1"
    ),
    "expected a paused→installing update call"
  );
  assert.ok(
    updateCalls.some(
      (u) => u.status === "running" && u.health_status === "running"
    ),
    "expected an installing→running update call"
  );
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

test("POST /api/sandbox/[id]/resume emits cancelled when paused → installing CAS fails", async () => {
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

test("POST /api/sandbox/[id]/resume emits cancelled and not ready when installing → running CAS fails", async () => {
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

import assert from "node:assert/strict";
import test from "node:test";
import type { SandboxRecord } from "@/lib/types";
import {
  buildOwnedRepoWithGithubAccess,
  buildSandboxCollectionRequest,
  buildSandboxServiceRouteAuth,
  buildSandboxServiceWorkspace,
  loadSandboxRouteModule,
} from "./sandbox-service-route-test-harness";

type SandboxPostHandlerOverrides = NonNullable<
  Parameters<
    (typeof import("../../app/api/sandbox/route"))["createSandboxPostHandler"]
  >[0]
>;

async function createSandboxPostTestHandler(
  overrides: SandboxPostHandlerOverrides = {}
) {
  const routeModule = await loadSandboxRouteModule();
  return routeModule.createSandboxPostHandler({
    validateVercelProjectAccess: async (input) => ({
      ok: true as const,
      data: { projectId: input.projectId },
    }),
    ...overrides,
  });
}

test("interactive sandbox launches only auto-queue snapshot warmup when the feature flag is enabled", async () => {
  const { shouldQueueSnapshotWarmupOnSandboxLaunch } =
    await loadSandboxRouteModule();
  const previousValue = process.env.ENABLE_SANDBOX_SNAPSHOT_WARMUP;

  try {
    delete process.env.ENABLE_SANDBOX_SNAPSHOT_WARMUP;
    assert.equal(shouldQueueSnapshotWarmupOnSandboxLaunch(), false);

    process.env.ENABLE_SANDBOX_SNAPSHOT_WARMUP = "true";
    assert.equal(shouldQueueSnapshotWarmupOnSandboxLaunch(), true);

    process.env.ENABLE_SANDBOX_SNAPSHOT_WARMUP = "1";
    assert.equal(shouldQueueSnapshotWarmupOnSandboxLaunch(), true);

    process.env.ENABLE_SANDBOX_SNAPSHOT_WARMUP = "false";
    assert.equal(shouldQueueSnapshotWarmupOnSandboxLaunch(), false);
  } finally {
    if (previousValue === undefined) {
      delete process.env.ENABLE_SANDBOX_SNAPSHOT_WARMUP;
    } else {
      process.env.ENABLE_SANDBOX_SNAPSHOT_WARMUP = previousValue;
    }
  }
});

test("summarizeDeferredSnapshotWarmupQueueResult treats expected skips as informational", async () => {
  const { summarizeDeferredSnapshotWarmupQueueResult } =
    await loadSandboxRouteModule();

  assert.deepEqual(
    summarizeDeferredSnapshotWarmupQueueResult({
      queued: false,
      reason: "in_progress",
      runtimeProvider: null,
      runtimeRunId: null,
      workflowRunId: null,
    }),
    {
      logLevel: "info",
      logMessage:
        "[sandbox/create] Deferred snapshot build is already in progress",
      warningMessage: null,
      details: { reason: "in_progress" },
    }
  );
});

test("summarizeDeferredSnapshotWarmupQueueResult surfaces unexpected skips for operators", async () => {
  const { summarizeDeferredSnapshotWarmupQueueResult } =
    await loadSandboxRouteModule();

  assert.deepEqual(
    summarizeDeferredSnapshotWarmupQueueResult({
      queued: false,
      reason: "repo_not_found",
      runtimeProvider: null,
      runtimeRunId: null,
      workflowRunId: null,
    }),
    {
      logLevel: "warn",
      logMessage:
        "[sandbox/create] Deferred snapshot build could not be queued because the repo state was unavailable",
      warningMessage: "Automatic snapshot warmup could not be queued.",
      details: { reason: "repo_not_found" },
    }
  );
});

test("classifySandboxLaunchFailure preserves sandbox request validation errors", async () => {
  const { classifySandboxLaunchFailure } = await loadSandboxRouteModule();
  const { SandboxCreateRequestValidationError } =
    await import("@/lib/sandbox/client");

  const failure = classifySandboxLaunchFailure(
    new SandboxCreateRequestValidationError(
      "reserved_port",
      "Sandbox requested reserved port 8080. Change the repo sandbox dev port or dev command to a supported port such as 3000 or 5173."
    )
  );

  assert.equal(
    failure.actionableMessage,
    "Sandbox requested reserved port 8080. Change the repo sandbox dev port or dev command to a supported port such as 3000 or 5173."
  );
  assert.equal(failure.phase, "create");
});

test("classifySandboxLaunchFailure maps raw Vercel reserved_port envelopes to actionable guidance", async () => {
  const { classifySandboxLaunchFailure } = await loadSandboxRouteModule();

  const err = Object.assign(new Error("Status code 400 is not ok"), {
    json: {
      error: {
        code: "reserved_port",
        message: "Port 8080 is reserved by the system",
      },
    },
  });

  const failure = classifySandboxLaunchFailure(err);

  assert.equal(
    failure.actionableMessage,
    "Vercel rejected the sandbox request: reserved_port: Port 8080 is reserved by the system. Change the repo sandbox dev port or dev command to a supported port such as 3000 or 5173."
  );
  assert.equal(failure.phase, "create");
});

test("classifySandboxLaunchFailure maps raw Vercel payload-too-large envelopes to actionable guidance", async () => {
  const { classifySandboxLaunchFailure } = await loadSandboxRouteModule();

  const err = Object.assign(new Error("Status code 400 is not ok"), {
    json: {
      error: {
        code: "bad_request",
        message: "env payload too large (4349 bytes; max 4096)",
      },
    },
  });

  const failure = classifySandboxLaunchFailure(err);

  assert.equal(
    failure.actionableMessage,
    "Vercel rejected the sandbox request: bad_request: env payload too large (4349 bytes; max 4096). Remove or shorten sandbox env vars before launching."
  );
  assert.equal(failure.phase, "create");
});

test("shouldLoadSandboxLaunchFailureDiagnostics only loads project diagnostics after sandbox creation", async () => {
  const { shouldLoadSandboxLaunchFailureDiagnostics } =
    await loadSandboxRouteModule();

  type LaunchFailureState = Parameters<
    typeof shouldLoadSandboxLaunchFailureDiagnostics
  >[0];

  const baseState: LaunchFailureState = {
    sandbox: null,
    previewUrl: null,
    restoredFromSnapshot: false,
    restoredFromBaselineSnapshot: false,
    shouldQueueDeferredSnapshot: false,
    streamSandboxRecord: {} as never,
  };

  assert.equal(shouldLoadSandboxLaunchFailureDiagnostics(baseState), false);
  assert.equal(
    shouldLoadSandboxLaunchFailureDiagnostics({
      ...baseState,
      sandbox: { name: "sandbox-1" } as never,
    }),
    true
  );
});

test("toStreamStatusSandboxRecord preserves normalized client records for running status events", async () => {
  const { toStreamStatusSandboxRecord } = await loadSandboxRouteModule();

  const readySandbox: SandboxRecord = {
    id: "sandbox-1",
    user_id: "user-123",
    repo_id: "repo-123",
    sandbox_id: "vm_123",
    base_branch: "main",
    working_branch: "main",
    snapshot_id: null,
    stop_reason: null,
    install_log: "",
    dev_log: "",
    runtime: "node22",
    terminal_cwd: null,
    created_at: "2026-04-01T10:00:00.000Z",
    last_active_at: "2026-04-01T10:01:00.000Z",
    billing_summary: {
      source: "platform",
      label: "Mogplex billing",
      project_id: "project-123",
      team_id: null,
      team_label: "Personal",
    },
    runtime_summary: {
      sandbox_id: "vm_123",
      status: "running",
      health_status: "running",
      preview_url: "https://preview.example.com",
      last_health_check_at: "2026-04-01T10:01:00.000Z",
      last_preview_http_status: 200,
      boot_attempts: 1,
      last_boot_started_at: "2026-04-01T10:00:00.000Z",
      last_boot_completed_at: "2026-04-01T10:01:00.000Z",
    },
    error_summary: {
      current_error: null,
      last_preview_error: null,
      last_boot_error: null,
      display_error: null,
      has_errors: false,
    },
  };

  const result = toStreamStatusSandboxRecord(readySandbox);

  assert.equal(result.runtime_summary.status, "running");
  assert.equal(result.runtime_summary.health_status, "running");
  assert.equal(
    result.runtime_summary.preview_url,
    "https://preview.example.com"
  );
  assert.equal("status" in result, false);
});

test("buildSandboxInstallingRecordUpdates stores the Vercel persistence flag", async () => {
  const { buildSandboxInstallingRecordUpdates } =
    await loadSandboxRouteModule();

  assert.deepEqual(
    buildSandboxInstallingRecordUpdates({
      sandboxId: "vm_ephemeral",
      sandbox: { sandbox: { persistent: false } },
    }),
    {
      sandbox_id: "vm_ephemeral",
      status: "installing",
      persistent: false,
    }
  );

  assert.deepEqual(
    buildSandboxInstallingRecordUpdates({
      sandboxId: "vm_persistent",
      sandbox: { sandbox: { persistent: true } },
    }),
    {
      sandbox_id: "vm_persistent",
      status: "installing",
      persistent: true,
    }
  );
});

test("resolvePendingSandboxPersistenceFlag mirrors the sandbox create persistence gate", async () => {
  const { resolvePendingSandboxPersistenceFlag } =
    await loadSandboxRouteModule();
  const previousEnable = process.env.ENABLE_PERSISTENT_SANDBOXES;
  const previousDisable = process.env.DISABLE_PERSISTENT_SANDBOXES;

  try {
    delete process.env.ENABLE_PERSISTENT_SANDBOXES;
    delete process.env.DISABLE_PERSISTENT_SANDBOXES;
    assert.equal(resolvePendingSandboxPersistenceFlag(), false);

    process.env.ENABLE_PERSISTENT_SANDBOXES = "true";
    assert.equal(resolvePendingSandboxPersistenceFlag(), true);

    process.env.DISABLE_PERSISTENT_SANDBOXES = "true";
    assert.equal(resolvePendingSandboxPersistenceFlag(), false);
  } finally {
    if (previousEnable === undefined) {
      delete process.env.ENABLE_PERSISTENT_SANDBOXES;
    } else {
      process.env.ENABLE_PERSISTENT_SANDBOXES = previousEnable;
    }

    if (previousDisable === undefined) {
      delete process.env.DISABLE_PERSISTENT_SANDBOXES;
    } else {
      process.env.DISABLE_PERSISTENT_SANDBOXES = previousDisable;
    }
  }
});

test("POST /api/sandbox returns 404 for repo IDs the caller does not own", async () => {
  let accessLookups = 0;
  let sandboxCreations = 0;

  const handler = await createSandboxPostTestHandler({
    getSandboxServiceCredentials: async () => buildSandboxServiceRouteAuth(),
    getOwnedRepoWithGithubAccessToken: async (repoId, userId, options) => {
      accessLookups += 1;
      assert.equal(repoId, "repo-999");
      assert.equal(userId, "user-123");
      assert.equal(
        options?.select,
        "*, workspace:workspaces(id, sandbox_billing_mode, sandbox_timeout_ms, sandbox_vercel_project_id, sandbox_vercel_team_id)"
      );
      return { repo: null, githubToken: null };
    },
    createSandboxForRepo: async () => {
      sandboxCreations += 1;
      throw new Error("createSandboxForRepo should not be called");
    },
    createSandboxFromSnapshot: async () => {
      sandboxCreations += 1;
      throw new Error("createSandboxFromSnapshot should not be called");
    },
  });

  const response = await handler(
    buildSandboxCollectionRequest({
      method: "POST",
      init: {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId: "repo-999" }),
      },
    })
  );

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Repo not found" });
  assert.equal(accessLookups, 1);
  assert.equal(sandboxCreations, 0);
});

test("POST /api/sandbox returns 400 when an owned repo has no GitHub token", async () => {
  let sandboxCreations = 0;

  const handler = await createSandboxPostTestHandler({
    getSandboxServiceCredentials: async () => buildSandboxServiceRouteAuth(),
    getOwnedRepoWithGithubAccessToken: async () =>
      buildOwnedRepoWithGithubAccess({
        repo: { runtime: null },
        githubToken: null,
      }),
    createSandboxForRepo: async () => {
      sandboxCreations += 1;
      throw new Error("createSandboxForRepo should not be called");
    },
    createSandboxFromSnapshot: async () => {
      sandboxCreations += 1;
      throw new Error("createSandboxFromSnapshot should not be called");
    },
  });

  const response = await handler(
    buildSandboxCollectionRequest({
      method: "POST",
      init: {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId: "repo-123" }),
      },
    })
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "Connect GitHub account first",
  });
  assert.equal(sandboxCreations, 0);
});

test("POST /api/sandbox blocks platform-billed launches for users without platform sandbox access", async () => {
  const handler = await createSandboxPostTestHandler({
    getSandboxServiceCredentials: async () =>
      buildSandboxServiceRouteAuth({ allowPlatformSandbox: false }),
    getOwnedRepoWithGithubAccessToken: async () =>
      buildOwnedRepoWithGithubAccess({
        repo: { runtime: null },
        workspace: buildSandboxServiceWorkspace({
          id: "ws-1",
          sandbox_billing_mode: "platform",
        }),
      }),
    createSandboxForRepo: async () => {
      throw new Error("createSandboxForRepo should not be called");
    },
    createSandboxFromSnapshot: async () => {
      throw new Error("createSandboxFromSnapshot should not be called");
    },
  });

  const response = await handler(
    buildSandboxCollectionRequest({
      method: "POST",
      init: {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId: "repo-123" }),
      },
    })
  );

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error:
      "Hosted sandbox compute requires a positive billing balance. Add funds or choose a plan in Settings > Billing, or link Personal Vercel and select a billing project.",
  });
});

test("POST /api/sandbox rejects an inaccessible hosted Vercel project before creating a sandbox", async () => {
  let sandboxCreations = 0;
  let activeSandboxLookups = 0;
  const accessChecks: Array<Record<string, unknown>> = [];

  const handler = await createSandboxPostTestHandler({
    getSandboxServiceCredentials: async () =>
      buildSandboxServiceRouteAuth({
        vercelToken: "platform-vercel-token",
        vercelTeamId: "platform-team",
        vercelProjectId: "stale-platform-project",
      }),
    getOwnedRepoWithGithubAccessToken: async () =>
      buildOwnedRepoWithGithubAccess({
        workspace: buildSandboxServiceWorkspace({
          sandbox_billing_mode: "platform",
        }),
      }),
    validateVercelProjectAccess: async (input) => {
      accessChecks.push(input);
      return {
        ok: false as const,
        error: {
          code: "PROJECT_NOT_FOUND",
          status: 404,
          message: "Could not find project: stale-platform-project",
        },
      };
    },
    getActiveSandboxForRepo: async () => {
      activeSandboxLookups += 1;
      return null;
    },
    createSandboxForRepo: async () => {
      sandboxCreations += 1;
      throw new Error("createSandboxForRepo should not be called");
    },
    createSandboxFromSnapshot: async () => {
      sandboxCreations += 1;
      throw new Error("createSandboxFromSnapshot should not be called");
    },
  });

  const response = await handler(
    buildSandboxCollectionRequest({
      method: "POST",
      init: {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId: "repo-123" }),
      },
    })
  );

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error:
      "Hosted sandbox service is temporarily unavailable. Please try again shortly.",
    code: "SANDBOX_SERVICE_UNAVAILABLE",
  });
  assert.deepEqual(accessChecks, [
    {
      authMode: "platform",
      vercelToken: "platform-vercel-token",
      teamId: "platform-team",
      projectId: "stale-platform-project",
    },
  ]);
  assert.equal(activeSandboxLookups, 0);
  assert.equal(sandboxCreations, 0);
});

test("POST /api/sandbox returns linked-project repair guidance when a user-billed Vercel project is inaccessible", async () => {
  let sandboxCreations = 0;
  const persistedRepoStates: Array<Record<string, unknown>> = [];

  const handler = await createSandboxPostTestHandler({
    getSandboxServiceCredentials: async () =>
      buildSandboxServiceRouteAuth({
        vercelToken: "platform-vercel-token",
        vercelProjectId: "platform-project",
        userVercelToken: "user-vercel-token",
        userVercelTeamId: "team-acme",
      }),
    getOwnedRepoWithGithubAccessToken: async () =>
      buildOwnedRepoWithGithubAccess({
        repo: {
          sandbox_billing_mode_override: "user_vercel_project",
          vercel_team_id: "team-acme",
          vercel_project_id: "repo-project",
        },
        workspace: buildSandboxServiceWorkspace({
          sandbox_billing_mode: "platform",
        }),
      }),
    validateVercelProjectAccess: async () => ({
      ok: false as const,
      error: {
        code: "PROJECT_NOT_FOUND",
        status: 404,
        message: "missing",
      },
    }),
    persistRepoVercelLinkState: async (repoId, userId, state) => {
      persistedRepoStates.push({ repoId, userId, ...state });
    },
    createSandboxForRepo: async () => {
      sandboxCreations += 1;
      throw new Error("createSandboxForRepo should not be called");
    },
    createSandboxFromSnapshot: async () => {
      sandboxCreations += 1;
      throw new Error("createSandboxFromSnapshot should not be called");
    },
  });

  const response = await handler(
    buildSandboxCollectionRequest({
      method: "POST",
      init: {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId: "repo-123" }),
      },
    })
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error:
      "The repo-linked Vercel project is missing or inaccessible. Select or create a different project to restore user-billed sandbox launch.",
    code: "VERCEL_LINKED_PROJECT_INVALID",
    linkedProjectValidation: {
      state: "inaccessible",
      source: "repo",
      message:
        "The repo-linked Vercel project is missing or inaccessible. Select or create a different project to restore user-billed sandbox launch.",
      action: "select_project",
    },
  });
  assert.equal(sandboxCreations, 0);
  assert.deepEqual(persistedRepoStates, [
    {
      repoId: "repo-123",
      userId: "user-123",
      vercel_link_status: "inaccessible",
      vercel_link_checked_at: persistedRepoStates[0]?.vercel_link_checked_at,
      vercel_link_error_code: "PROJECT_NOT_FOUND",
      vercel_link_message:
        "The repo-linked Vercel project is missing or inaccessible. Select or create a different project to restore user-billed sandbox launch.",
    },
  ]);
  assert.equal(typeof persistedRepoStates[0]?.vercel_link_checked_at, "string");
});

test("POST /api/sandbox persists missing_project on the owning workspace before blocking user-billed launch", async () => {
  const persistedWorkspaceStates: Array<Record<string, unknown>> = [];

  const handler = await createSandboxPostTestHandler({
    getSandboxServiceCredentials: async () =>
      buildSandboxServiceRouteAuth({
        vercelToken: "platform-vercel-token",
        vercelProjectId: "platform-project",
      }),
    getOwnedRepoWithGithubAccessToken: async () =>
      buildOwnedRepoWithGithubAccess({
        workspace: buildSandboxServiceWorkspace({
          id: "ws-1",
          sandbox_billing_mode: "user_vercel_project",
        }),
      }),
    persistWorkspaceVercelLinkState: async (workspaceId, userId, state) => {
      persistedWorkspaceStates.push({ workspaceId, userId, ...state });
    },
    createSandboxForRepo: async () => {
      throw new Error("createSandboxForRepo should not be called");
    },
    createSandboxFromSnapshot: async () => {
      throw new Error("createSandboxFromSnapshot should not be called");
    },
  });

  const response = await handler(
    buildSandboxCollectionRequest({
      method: "POST",
      init: {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId: "repo-123" }),
      },
    })
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "Select or create a Vercel project for user-owned sandbox billing.",
  });
  assert.deepEqual(persistedWorkspaceStates, [
    {
      workspaceId: "ws-1",
      userId: "user-123",
      vercel_link_status: "missing_project",
      vercel_link_checked_at:
        persistedWorkspaceStates[0]?.vercel_link_checked_at,
      vercel_link_error_code: "MISSING_PROJECT",
      vercel_link_message:
        "Select or create a workspace-linked Vercel project to keep user-billed sandbox launch working.",
    },
  ]);
  assert.equal(
    typeof persistedWorkspaceStates[0]?.vercel_link_checked_at,
    "string"
  );
});

test("POST /api/sandbox returns 429 when sandbox boot limits are exceeded", async () => {
  let sandboxCreations = 0;

  const handler = await createSandboxPostTestHandler({
    getSandboxServiceCredentials: async () => buildSandboxServiceRouteAuth(),
    getOwnedRepoWithGithubAccessToken: async () =>
      buildOwnedRepoWithGithubAccess(),
    getActiveSandboxForRepo: async () => null,
    resolveNameCollision: async () => ({ kind: "create" }),
    enforceSandboxBootLimits: async () => ({
      allowed: false,
      status: 429,
      code: "sandbox_boot_rate_limited",
      error: "Sandbox boot rate limit exceeded",
      reason: "sandbox_boot_hourly_rate_exceeded",
      retryAfterSeconds: 60,
      limit: {
        name: "sandbox_boots_per_hour",
        value: 5,
        windowSeconds: 3600,
      },
    }),
    createSandboxForRepo: async () => {
      sandboxCreations += 1;
      throw new Error("createSandboxForRepo should not be called");
    },
    createSandboxFromSnapshot: async () => {
      sandboxCreations += 1;
      throw new Error("createSandboxFromSnapshot should not be called");
    },
  });

  const response = await handler(
    buildSandboxCollectionRequest({
      method: "POST",
      init: {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId: "repo-123" }),
      },
    })
  );

  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), {
    error: "Sandbox boot rate limit exceeded",
    code: "sandbox_boot_rate_limited",
    retryAfterSeconds: 60,
    limit: {
      name: "sandbox_boots_per_hour",
      value: 5,
      windowSeconds: 3600,
    },
  });
  assert.equal(sandboxCreations, 0);
});

test("POST /api/sandbox returns the matched record when name collision resolves to resume", async () => {
  const released: Array<{ userId: string; claimId: string | null }> = [];
  let sandboxCreations = 0;

  const matchedRecord = {
    id: "sandbox-resume-1",
    user_id: "user-123",
    repo_id: "repo-123",
    sandbox_id: "vm_resume",
    base_branch: "main",
    working_branch: "main",
    snapshot_id: "snap-1",
    stop_reason: null,
    created_at: "2026-04-01T10:00:00.000Z",
    last_active_at: "2026-04-01T10:01:00.000Z",
    billing_summary: {
      source: "platform",
      label: "Platform",
      project_id: null,
      team_id: null,
      team_label: "Platform",
    },
    runtime_summary: {
      sandbox_id: "vm_resume",
      status: "paused",
      health_status: "paused",
      preview_url: null,
      last_health_check_at: null,
      last_preview_http_status: null,
      boot_attempts: 1,
      last_boot_started_at: null,
      last_boot_completed_at: null,
      effective_timeout_ms: 3_600_000,
      persistent: false,
      vercel_diagnostics: null,
    },
    error_summary: {
      current_error: null,
      last_preview_error: null,
      last_boot_error: null,
      display_error: null,
      has_errors: false,
    },
  };

  const handler = await createSandboxPostTestHandler({
    getSandboxServiceCredentials: async () => buildSandboxServiceRouteAuth(),
    getOwnedRepoWithGithubAccessToken: async () =>
      buildOwnedRepoWithGithubAccess(),
    getActiveSandboxForRepo: async () => null,
    enforceSandboxBootLimits: async () => ({
      allowed: true,
      claimId: "claim-resume-1",
    }),
    resolveNameCollision: async (input) => {
      released.push({ userId: "noop", claimId: input.limitClaimId ?? null });
      return { kind: "resume", record: matchedRecord as never };
    },
    createSandboxForRepo: async () => {
      sandboxCreations += 1;
      throw new Error("createSandboxForRepo should not be called");
    },
    createSandboxFromSnapshot: async () => {
      sandboxCreations += 1;
      throw new Error("createSandboxFromSnapshot should not be called");
    },
  });

  const response = await handler(
    buildSandboxCollectionRequest({
      method: "POST",
      init: {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId: "repo-123" }),
      },
    })
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.sandbox.id, "sandbox-resume-1");
  assert.equal(sandboxCreations, 0);
  assert.equal(
    released[0]?.claimId,
    "claim-resume-1",
    "boot-limit claim should reach the collision resolver so resume can release it"
  );
});

test("POST /api/sandbox enforces boot limits and threads the claim id through the adopt path", async () => {
  let sandboxCreations = 0;
  let observedClaimId: string | null | undefined;

  const adoptedRecord = {
    id: "sandbox-adopt-1",
    user_id: "user-123",
    repo_id: "repo-123",
    sandbox_id: "vm_adopt",
    base_branch: "main",
    working_branch: "main",
    snapshot_id: null,
    stop_reason: null,
    created_at: "2026-04-02T10:00:00.000Z",
    last_active_at: "2026-04-02T10:01:00.000Z",
    billing_summary: {
      source: "platform",
      label: "Platform",
      project_id: null,
      team_id: null,
      team_label: "Platform",
    },
    runtime_summary: {
      sandbox_id: "vm_adopt",
      status: "running",
      health_status: "unknown",
      preview_url: null,
      last_health_check_at: null,
      last_preview_http_status: null,
      boot_attempts: 0,
      last_boot_started_at: null,
      last_boot_completed_at: null,
      effective_timeout_ms: 3_600_000,
      persistent: false,
      vercel_diagnostics: null,
    },
    error_summary: {
      current_error: null,
      last_preview_error: null,
      last_boot_error: null,
      display_error: null,
      has_errors: false,
    },
  };

  const handler = await createSandboxPostTestHandler({
    getSandboxServiceCredentials: async () => buildSandboxServiceRouteAuth(),
    getOwnedRepoWithGithubAccessToken: async () =>
      buildOwnedRepoWithGithubAccess(),
    getActiveSandboxForRepo: async () => null,
    enforceSandboxBootLimits: async () => ({
      allowed: true,
      claimId: "claim-adopt-1",
    }),
    resolveNameCollision: async (input) => {
      observedClaimId = input.limitClaimId;
      return { kind: "adopt", record: adoptedRecord as never };
    },
    createSandboxForRepo: async () => {
      sandboxCreations += 1;
      throw new Error("createSandboxForRepo should not be called");
    },
    createSandboxFromSnapshot: async () => {
      sandboxCreations += 1;
      throw new Error("createSandboxFromSnapshot should not be called");
    },
  });

  const response = await handler(
    buildSandboxCollectionRequest({
      method: "POST",
      init: {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId: "repo-123" }),
      },
    })
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.sandbox.id, "sandbox-adopt-1");
  assert.equal(sandboxCreations, 0);
  assert.equal(
    observedClaimId,
    "claim-adopt-1",
    "boot-limit claim should be threaded into the adopt path so the adopted record participates in active counts"
  );
});

test("POST /api/sandbox scopes deterministic names by launch rootDirectory", async () => {
  const collisionInputs: Array<{
    name: string;
    rootDirectory: string | null;
  }> = [];

  const handler = await createSandboxPostTestHandler({
    getSandboxServiceCredentials: async () => buildSandboxServiceRouteAuth(),
    getOwnedRepoWithGithubAccessToken: async () =>
      buildOwnedRepoWithGithubAccess(),
    getActiveSandboxForRepo: async () => null,
    enforceSandboxBootLimits: async () => ({
      allowed: true,
    }),
    resolveNameCollision: async (input) => {
      collisionInputs.push({
        name: input.name,
        rootDirectory: input.rootDirectory,
      });
      return {
        kind: "resume",
        record: {
          id: `sandbox-${collisionInputs.length}`,
          sandbox_id: input.name,
        } as never,
      };
    },
    createSandboxForRepo: async () => {
      throw new Error("createSandboxForRepo should not be called");
    },
    createSandboxFromSnapshot: async () => {
      throw new Error("createSandboxFromSnapshot should not be called");
    },
  });

  const rootResponse = await handler(
    buildSandboxCollectionRequest({
      method: "POST",
      init: {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId: "repo-123", rootDirectory: null }),
      },
    })
  );
  const appResponse = await handler(
    buildSandboxCollectionRequest({
      method: "POST",
      init: {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoId: "repo-123",
          rootDirectory: "apps/web",
        }),
      },
    })
  );

  assert.equal(rootResponse.status, 200);
  assert.equal(appResponse.status, 200);
  assert.deepEqual(collisionInputs, [
    {
      name: "mogplex-user12-repo12-main-root",
      rootDirectory: null,
    },
    {
      name: "mogplex-user12-repo12-main-apps-web",
      rootDirectory: "apps/web",
    },
  ]);
  assert.notEqual(collisionInputs[0]?.name, collisionInputs[1]?.name);
});

test("POST /api/sandbox scopes active lookups and deterministic names by active team", async () => {
  const lookupCalls: Array<{
    productTeamId: string | null | undefined;
  }> = [];
  const collisionInputs: Array<{
    name: string;
    productTeamId: string | null | undefined;
    actorUserId: string | null | undefined;
  }> = [];

  const handler = await createSandboxPostTestHandler({
    getSandboxServiceCredentials: async (_request, options) => {
      assert.equal(options?.teamId, "00000000-0000-4000-8000-000000123456");
      assert.equal(options?.requireCapability, "tools.bash");
      return buildSandboxServiceRouteAuth();
    },
    getOwnedRepoWithGithubAccessToken: async () =>
      buildOwnedRepoWithGithubAccess(),
    getActiveSandboxForRepo: async (
      _repoId,
      _userId,
      _workingBranch,
      _rootDirectory,
      productTeamId
    ) => {
      lookupCalls.push({ productTeamId });
      return null;
    },
    enforceSandboxBootLimits: async () => ({
      allowed: true,
    }),
    resolveNameCollision: async (input) => {
      collisionInputs.push({
        name: input.name,
        productTeamId: input.productTeamId,
        actorUserId: input.actorUserId,
      });
      return {
        kind: "resume",
        record: {
          id: "sandbox-team-1",
          sandbox_id: input.name,
        } as never,
      };
    },
    createSandboxForRepo: async () => {
      throw new Error("createSandboxForRepo should not be called");
    },
    createSandboxFromSnapshot: async () => {
      throw new Error("createSandboxFromSnapshot should not be called");
    },
  });

  const response = await handler(
    buildSandboxCollectionRequest({
      method: "POST",
      init: {
        headers: {
          "Content-Type": "application/json",
          "x-mogplex-team-id": "00000000-0000-4000-8000-000000123456",
        },
        body: JSON.stringify({ repoId: "repo-123" }),
      },
    })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(lookupCalls, [
    { productTeamId: "00000000-0000-4000-8000-000000123456" },
  ]);
  assert.deepEqual(collisionInputs, [
    {
      name: "mogplex-user12-t000000-repo12-main-root",
      productTeamId: "00000000-0000-4000-8000-000000123456",
      actorUserId: "user-123",
    },
  ]);
});

test("POST /api/sandbox returns 429 before doing collision lookup when boot limits are exceeded", async () => {
  let collisionCalls = 0;

  const handler = await createSandboxPostTestHandler({
    getSandboxServiceCredentials: async () => buildSandboxServiceRouteAuth(),
    getOwnedRepoWithGithubAccessToken: async () =>
      buildOwnedRepoWithGithubAccess(),
    getActiveSandboxForRepo: async () => null,
    enforceSandboxBootLimits: async () => ({
      allowed: false,
      status: 429,
      code: "sandbox_boot_rate_limited",
      error: "Sandbox boot rate limit exceeded",
      reason: "sandbox_boot_hourly_rate_exceeded",
      retryAfterSeconds: 60,
      limit: {
        name: "sandbox_boots_per_hour",
        value: 5,
        windowSeconds: 3600,
      },
    }),
    resolveNameCollision: async () => {
      collisionCalls += 1;
      return { kind: "create" };
    },
    createSandboxForRepo: async () => {
      throw new Error("createSandboxForRepo should not be called");
    },
    createSandboxFromSnapshot: async () => {
      throw new Error("createSandboxFromSnapshot should not be called");
    },
  });

  const response = await handler(
    buildSandboxCollectionRequest({
      method: "POST",
      init: {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId: "repo-123" }),
      },
    })
  );

  assert.equal(response.status, 429);
  assert.equal(
    collisionCalls,
    0,
    "collision check should be skipped when boot limits already denied the request"
  );
});

test("POST /api/sandbox returns an existing running sandbox with normalized summaries", async () => {
  let sandboxCreations = 0;

  const existing = {
    id: "sandbox-1",
    sandbox_id: "vm_123",
    repo_id: "repo-123",
    user_id: "user-123",
    status: "running",
    preview_url: "https://preview.example.com",
    runtime: "node22",
    health_status: "running",
    billing_source: "user_vercel_project",
    billing_team_id: "team-acme",
    billing_project_id: "project-acme",
    vercel_team_id: "team-acme",
    vercel_project_id: "project-acme",
    created_at: "2026-04-01T10:00:00.000Z",
    last_active_at: "2026-04-01T10:01:00.000Z",
  };

  const handler = await createSandboxPostTestHandler({
    getSandboxServiceCredentials: async () => buildSandboxServiceRouteAuth(),
    getOwnedRepoWithGithubAccessToken: async () =>
      buildOwnedRepoWithGithubAccess(),
    getActiveSandboxForRepo: async (_repoId, _userId, workingBranch) => {
      assert.equal(workingBranch, "main");
      return existing as never;
    },
    resolveActiveSandboxState: async () => ({ kind: "running" }),
    createSandboxForRepo: async () => {
      sandboxCreations += 1;
      throw new Error("createSandboxForRepo should not be called");
    },
    createSandboxFromSnapshot: async () => {
      sandboxCreations += 1;
      throw new Error("createSandboxFromSnapshot should not be called");
    },
  });

  const response = await handler(
    buildSandboxCollectionRequest({
      method: "POST",
      init: {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId: "repo-123" }),
      },
    })
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.sandbox.id, "sandbox-1");
  assert.deepEqual(payload.sandbox.billing_summary, {
    source: "user_vercel_project",
    label: "Your Vercel project",
    project_id: "project-acme",
    team_id: "team-acme",
    team_label: "team-acme",
  });
  assert.equal("status" in payload.sandbox, false);
  assert.equal("preview_url" in payload.sandbox, false);
  assert.equal(sandboxCreations, 0);
});

test("POST /api/sandbox scopes the active-sandbox lookup by the launch-time rootDirectory override", async () => {
  const lookupCalls: Array<{
    workingBranch: string | null | undefined;
    rootDirectory: string | null | undefined;
  }> = [];

  const handler = await createSandboxPostTestHandler({
    getSandboxServiceCredentials: async () => buildSandboxServiceRouteAuth(),
    getOwnedRepoWithGithubAccessToken: async () =>
      buildOwnedRepoWithGithubAccess({
        repo: { root_directory: "packages/api" },
      }),
    getActiveSandboxForRepo: async (
      _repoId,
      _userId,
      workingBranch,
      rootDirectory
    ) => {
      lookupCalls.push({ workingBranch, rootDirectory });
      // Pretend a sandbox already exists at this path so the route
      // short-circuits before any creation work.
      return {
        id: "existing-sandbox",
        sandbox_id: "vm_existing",
        repo_id: "repo-123",
        user_id: "user-123",
        status: "running",
        preview_url: "https://preview.example.com",
        runtime: "node22",
        health_status: "running",
        billing_source: "user_vercel_project",
        billing_team_id: "team-acme",
        billing_project_id: "project-acme",
        vercel_team_id: "team-acme",
        vercel_project_id: "project-acme",
        root_directory: rootDirectory ?? null,
        created_at: "2026-04-25T03:00:00.000Z",
        last_active_at: "2026-04-25T03:00:00.000Z",
      } as never;
    },
    resolveActiveSandboxState: async () => ({ kind: "running" }),
    createSandboxForRepo: async () => {
      throw new Error("createSandboxForRepo should not be called");
    },
    createSandboxFromSnapshot: async () => {
      throw new Error("createSandboxFromSnapshot should not be called");
    },
  });

  // Launch with explicit override → lookup must filter on that path.
  const response = await handler(
    buildSandboxCollectionRequest({
      method: "POST",
      init: {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoId: "repo-123",
          rootDirectory: "apps/web",
        }),
      },
    })
  );

  assert.equal(response.status, 200);
  assert.equal(lookupCalls.length, 1);
  assert.equal(lookupCalls[0]?.rootDirectory, "apps/web");
});

test("POST /api/sandbox preserves repo.root_directory for non-monorepo repos when the launch payload omits the override", async () => {
  // Regression for mogplex review on PR #301: a non-monorepo repo with
  // repos.root_directory = "packages/api" must keep that path when the
  // launch dialog (which doesn't render the picker for non-monorepo
  // repos) submits without a rootDirectory field. If the dialog had
  // accidentally spread rootDirectory: null into the payload, the route
  // would have switched to "explicit repo root" and broken the
  // sandbox's working directory.
  const lookupCalls: Array<{ rootDirectory: string | null | undefined }> = [];

  const handler = await createSandboxPostTestHandler({
    getSandboxServiceCredentials: async () => buildSandboxServiceRouteAuth(),
    getOwnedRepoWithGithubAccessToken: async () =>
      buildOwnedRepoWithGithubAccess({
        repo: { root_directory: "packages/api" },
      }),
    getActiveSandboxForRepo: async (
      _repoId,
      _userId,
      _workingBranch,
      rootDirectory
    ) => {
      lookupCalls.push({ rootDirectory });
      return {
        id: "existing-sandbox",
        sandbox_id: "vm_existing",
        repo_id: "repo-123",
        user_id: "user-123",
        status: "running",
        preview_url: "https://preview.example.com",
        runtime: "node22",
        health_status: "running",
        billing_source: "user_vercel_project",
        billing_team_id: "team-acme",
        billing_project_id: "project-acme",
        vercel_team_id: "team-acme",
        vercel_project_id: "project-acme",
        root_directory: rootDirectory ?? null,
        created_at: "2026-04-25T03:00:00.000Z",
        last_active_at: "2026-04-25T03:00:00.000Z",
      } as never;
    },
    resolveActiveSandboxState: async () => ({ kind: "running" }),
    createSandboxForRepo: async () => {
      throw new Error("createSandboxForRepo should not be called");
    },
    createSandboxFromSnapshot: async () => {
      throw new Error("createSandboxFromSnapshot should not be called");
    },
  });

  const response = await handler(
    buildSandboxCollectionRequest({
      method: "POST",
      init: {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId: "repo-123" }),
      },
    })
  );

  assert.equal(response.status, 200);
  assert.equal(lookupCalls[0]?.rootDirectory, "packages/api");
});

test("POST /api/sandbox honours an explicit null rootDirectory override (repo-root choice on a monorepo)", async () => {
  // Counterpart to the test above: when the launch payload DOES include
  // rootDirectory: null, the route must treat it as an explicit "repo
  // root" choice and override repos.root_directory rather than
  // collapsing back to the repo default.
  const lookupCalls: Array<{ rootDirectory: string | null | undefined }> = [];

  const handler = await createSandboxPostTestHandler({
    getSandboxServiceCredentials: async () => buildSandboxServiceRouteAuth(),
    getOwnedRepoWithGithubAccessToken: async () =>
      buildOwnedRepoWithGithubAccess({
        repo: { root_directory: "packages/api" },
      }),
    getActiveSandboxForRepo: async (
      _repoId,
      _userId,
      _workingBranch,
      rootDirectory
    ) => {
      lookupCalls.push({ rootDirectory });
      return {
        id: "existing-sandbox",
        sandbox_id: "vm_existing",
        repo_id: "repo-123",
        user_id: "user-123",
        status: "running",
        preview_url: "https://preview.example.com",
        runtime: "node22",
        health_status: "running",
        billing_source: "user_vercel_project",
        billing_team_id: "team-acme",
        billing_project_id: "project-acme",
        vercel_team_id: "team-acme",
        vercel_project_id: "project-acme",
        root_directory: null,
        created_at: "2026-04-25T03:00:00.000Z",
        last_active_at: "2026-04-25T03:00:00.000Z",
      } as never;
    },
    resolveActiveSandboxState: async () => ({ kind: "running" }),
    createSandboxForRepo: async () => {
      throw new Error("createSandboxForRepo should not be called");
    },
    createSandboxFromSnapshot: async () => {
      throw new Error("createSandboxFromSnapshot should not be called");
    },
  });

  const response = await handler(
    buildSandboxCollectionRequest({
      method: "POST",
      init: {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId: "repo-123", rootDirectory: null }),
      },
    })
  );

  assert.equal(response.status, 200);
  assert.equal(lookupCalls[0]?.rootDirectory, null);
});

test("POST /api/sandbox falls back to repo.root_directory when launch omits rootDirectory", async () => {
  const lookupCalls: Array<{
    workingBranch: string | null | undefined;
    rootDirectory: string | null | undefined;
  }> = [];

  const handler = await createSandboxPostTestHandler({
    getSandboxServiceCredentials: async () => buildSandboxServiceRouteAuth(),
    getOwnedRepoWithGithubAccessToken: async () =>
      buildOwnedRepoWithGithubAccess({
        repo: { root_directory: "packages/api" },
      }),
    getActiveSandboxForRepo: async (
      _repoId,
      _userId,
      workingBranch,
      rootDirectory
    ) => {
      lookupCalls.push({ workingBranch, rootDirectory });
      return {
        id: "existing-sandbox",
        sandbox_id: "vm_existing",
        repo_id: "repo-123",
        user_id: "user-123",
        status: "running",
        preview_url: "https://preview.example.com",
        runtime: "node22",
        health_status: "running",
        billing_source: "user_vercel_project",
        billing_team_id: "team-acme",
        billing_project_id: "project-acme",
        vercel_team_id: "team-acme",
        vercel_project_id: "project-acme",
        root_directory: rootDirectory ?? null,
        created_at: "2026-04-25T03:00:00.000Z",
        last_active_at: "2026-04-25T03:00:00.000Z",
      } as never;
    },
    resolveActiveSandboxState: async () => ({ kind: "running" }),
    createSandboxForRepo: async () => {
      throw new Error("createSandboxForRepo should not be called");
    },
    createSandboxFromSnapshot: async () => {
      throw new Error("createSandboxFromSnapshot should not be called");
    },
  });

  const response = await handler(
    buildSandboxCollectionRequest({
      method: "POST",
      init: {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId: "repo-123" }),
      },
    })
  );

  assert.equal(response.status, 200);
  assert.equal(lookupCalls.length, 1);
  assert.equal(lookupCalls[0]?.rootDirectory, "packages/api");
});

test("GET /api/sandbox reconciles stale sandboxes and returns normalized summaries", async () => {
  const { createSandboxGetHandler } = await loadSandboxRouteModule();
  const stoppedIds: string[] = [];

  const handler = createSandboxGetHandler({
    getSandboxServiceCredentials: async () => buildSandboxServiceRouteAuth(),
    listSandboxesForUser: async () =>
      [
        {
          id: "sandbox-stale",
          sandbox_id: "vm_stale",
          repo_id: "repo-1",
          user_id: "user-123",
          status: "running",
          preview_url: null,
          runtime: "node22",
          health_status: "running",
          error: null,
          last_preview_http_status: null,
          last_preview_error: null,
          last_boot_error: null,
          boot_attempts: 1,
          last_boot_started_at: "2026-04-01T10:00:00.000Z",
          last_boot_completed_at: "2026-04-01T10:01:00.000Z",
          created_at: "2026-04-01T10:00:00.000Z",
          last_active_at: "2026-04-01T10:01:00.000Z",
          billing_source: "platform",
          billing_team_id: null,
          billing_project_id: "platform-project",
          vercel_team_id: null,
          vercel_project_id: "platform-project",
        },
        {
          id: "sandbox-live",
          sandbox_id: "vm_live",
          repo_id: "repo-2",
          user_id: "user-123",
          status: "running",
          preview_url: "https://preview.example.com",
          runtime: "node22",
          health_status: "running",
          error: null,
          last_preview_http_status: 200,
          last_preview_error: null,
          last_boot_error: null,
          boot_attempts: 2,
          last_boot_started_at: "2026-04-01T10:00:00.000Z",
          last_boot_completed_at: "2026-04-01T10:01:00.000Z",
          created_at: "2026-04-01T10:00:00.000Z",
          last_active_at: "2026-04-01T10:01:00.000Z",
          billing_source: "user_vercel_project",
          billing_team_id: "team-acme",
          billing_project_id: "project-acme",
          vercel_team_id: "team-acme",
          vercel_project_id: "project-acme",
        },
      ] as never,
    findStaleActiveSandboxIds: async () => ({
      staleIds: new Set(["sandbox-stale"]),
      skippedIds: new Set(["sandbox-skipped"]),
    }),
    stopSandboxRecord: async (id) => {
      stoppedIds.push(id);
      return null;
    },
  });

  const response = await handler(buildSandboxCollectionRequest());
  assert.equal(response.status, 200);

  const payload = await response.json();
  assert.deepEqual(stoppedIds, ["sandbox-stale"]);
  assert.equal(payload.sandboxes[0].runtime_summary.status, "stopped");
  assert.equal(
    payload.sandboxes[1].billing_summary.label,
    "Your Vercel project"
  );
  assert.equal("status" in payload.sandboxes[0], false);
  assert.equal("preview_url" in payload.sandboxes[1], false);
});

test("GET /api/sandbox validates and filters by active team", async () => {
  const { createSandboxGetHandler } = await loadSandboxRouteModule();
  const listCalls: Array<{ userId: string; productTeamId: string | null }> = [];
  const credentialTeamIds: Array<string | null | undefined> = [];
  const accessScopes: Array<[string, string | null | undefined]> = [];

  const handler = createSandboxGetHandler({
    getSandboxServiceCredentials: async (_request, options) => {
      credentialTeamIds.push(options?.teamId);
      return buildSandboxServiceRouteAuth();
    },
    loadUserPlatformAccess: async (userId, productTeamId) => {
      accessScopes.push([userId, productTeamId]);
      return { allowPlatformAi: true, allowPlatformSandbox: true };
    },
    resolveActiveTeamCapabilities: async (userId, teamId) => {
      assert.equal(userId, "user-123");
      assert.equal(teamId, "00000000-0000-4000-8000-000000123456");
      return { ok: true, teamId, capabilities: new Set(["*"]) };
    },
    listSandboxesForUser: async (userId, productTeamId) => {
      listCalls.push({ userId, productTeamId });
      return [];
    },
    findStaleActiveSandboxIds: async () => ({
      staleIds: new Set(),
      skippedIds: new Set(),
    }),
    stopSandboxRecord: async () => null,
  });

  const response = await handler(
    buildSandboxCollectionRequest({
      init: {
        headers: {
          "x-mogplex-team-id": "00000000-0000-4000-8000-000000123456",
        },
      },
    })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { sandboxes: [] });
  assert.deepEqual(credentialTeamIds, [undefined]);
  assert.deepEqual(accessScopes, [
    ["user-123", "00000000-0000-4000-8000-000000123456"],
  ]);
  assert.deepEqual(listCalls, [
    {
      userId: "user-123",
      productTeamId: "00000000-0000-4000-8000-000000123456",
    },
  ]);
});

test("GET /api/sandbox rejects a foreign team before loading team billing access", async () => {
  const { createSandboxGetHandler } = await loadSandboxRouteModule();
  let accessLookups = 0;
  let listCalls = 0;

  const handler = createSandboxGetHandler({
    getSandboxServiceCredentials: async () => buildSandboxServiceRouteAuth(),
    loadUserPlatformAccess: async () => {
      accessLookups += 1;
      return { allowPlatformAi: true, allowPlatformSandbox: true };
    },
    resolveActiveTeamCapabilities: async () => ({
      ok: false,
      status: 403,
      error: "Forbidden",
    }),
    listSandboxesForUser: async () => {
      listCalls += 1;
      return [];
    },
    findStaleActiveSandboxIds: async () => ({
      staleIds: new Set(),
      skippedIds: new Set(),
    }),
    stopSandboxRecord: async () => null,
  });

  const response = await handler(
    buildSandboxCollectionRequest({
      init: {
        headers: {
          "x-mogplex-team-id": "00000000-0000-4000-8000-000000123456",
        },
      },
    })
  );

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "Forbidden" });
  assert.equal(accessLookups, 0);
  assert.equal(listCalls, 0);
});

test("GET /api/sandbox?format=cli returns a flat CLI-shaped array and hides historical records", async () => {
  const { createSandboxGetHandler } = await loadSandboxRouteModule();

  const handler = createSandboxGetHandler({
    getSandboxServiceCredentials: async () => buildSandboxServiceRouteAuth(),
    listSandboxesForUser: async () =>
      [
        {
          id: "sandbox-1",
          sandbox_id: "vm_1",
          repo_id: "repo-1",
          user_id: "user-123",
          working_branch: "feat/x",
          status: "running",
          preview_url: "https://preview.example.com",
          runtime: "node22",
          health_status: "running",
          created_at: "2026-04-01T10:00:00.000Z",
          last_active_at: "2026-04-01T10:01:00.000Z",
          repos: {
            full_name: "webrenew/acme",
            sandbox_timeout_ms: null,
            workspaces: { name: "Default", sandbox_timeout_ms: null },
          },
        },
        {
          id: "sandbox-2",
          sandbox_id: "pending",
          repo_id: "repo-2",
          user_id: "user-123",
          working_branch: null,
          status: "creating",
          preview_url: null,
          runtime: "node22",
          health_status: "creating",
          created_at: "2026-04-02T10:00:00.000Z",
          last_active_at: "2026-04-02T10:01:00.000Z",
          repos: null,
        },
        {
          id: "sandbox-3",
          sandbox_id: "vm_3",
          repo_id: "repo-3",
          user_id: "user-123",
          working_branch: "feat/paused",
          status: "paused",
          preview_url: null,
          runtime: "node22",
          health_status: "paused",
          created_at: "2026-04-03T10:00:00.000Z",
          last_active_at: "2026-04-03T10:01:00.000Z",
          repos: null,
        },
        {
          id: "sandbox-4",
          sandbox_id: "vm_4",
          repo_id: "repo-4",
          user_id: "user-123",
          working_branch: null,
          status: "stopped",
          preview_url: null,
          runtime: "node22",
          health_status: "stopped",
          created_at: "2026-04-04T10:00:00.000Z",
          last_active_at: "2026-04-04T10:01:00.000Z",
          repos: null,
        },
        {
          id: "sandbox-5",
          sandbox_id: "vm_5",
          repo_id: "repo-5",
          user_id: "user-123",
          working_branch: null,
          status: "error",
          preview_url: null,
          runtime: "node22",
          health_status: "error",
          created_at: "2026-04-05T10:00:00.000Z",
          last_active_at: "2026-04-05T10:01:00.000Z",
          repos: null,
        },
      ] as never,
    findStaleActiveSandboxIds: async () => ({
      staleIds: new Set(),
      skippedIds: new Set(),
    }),
    stopSandboxRecord: async () => null,
  });

  const response = await handler(
    new Request("http://localhost/api/sandbox?format=cli")
  );
  assert.equal(response.status, 200);

  const payload = await response.json();
  assert.ok(Array.isArray(payload), "payload should be a bare array");
  // running + creating + paused visible; stopped and error filtered out.
  assert.equal(payload.length, 3);
  const visibleIds = payload.map((p: { id: string }) => p.id);
  assert.deepEqual(visibleIds.sort(), ["sandbox-1", "sandbox-2", "sandbox-3"]);
  assert.deepEqual(payload[0], {
    id: "sandbox-1",
    sandboxId: "vm_1",
    repo: "webrenew/acme",
    workspace: "Default",
    branch: "feat/x",
    status: "running",
    createdAt: "2026-04-01T10:00:00.000Z",
    url: "https://preview.example.com",
  });
  assert.equal(payload[1].sandboxId, null, "pending sandbox_id normalized");
  assert.equal(payload[1].repo, null);
  assert.equal(payload[1].workspace, null);
  assert.equal(payload[1].branch, null);
  assert.equal(payload[2].status, "paused");
});

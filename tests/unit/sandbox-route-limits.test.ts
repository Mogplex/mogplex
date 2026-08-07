import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOwnedRepoWithGithubAccess,
  buildSandboxCollectionRequest,
  buildSandboxServiceRouteAuth,
  createSandboxPostTestHandler,
} from "./helpers/sandbox-route-fixtures";

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

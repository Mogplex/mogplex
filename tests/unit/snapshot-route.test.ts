import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRepoRouteParams,
  buildRepoSnapshotRequest,
  buildSandboxServiceRepo,
  buildSandboxServiceRouteAuth,
  buildSandboxServiceWorkspace,
  loadSnapshotRouteModule,
} from "./sandbox-service-route-test-harness";

test("POST /api/repos/[id]/snapshot returns 429 when snapshot limits are exceeded", async () => {
  const { createSnapshotPostHandler } = await loadSnapshotRouteModule();

  const handler = createSnapshotPostHandler({
    getSandboxServiceCredentials: async () => buildSandboxServiceRouteAuth(),
    loadOwnedRepo: async () =>
      buildSandboxServiceRepo({
        repo: {
          sandbox_billing_target: "personal",
          snapshot_id: "snapshot-1",
          snapshot_created_at: "2026-03-23T11:50:00.000Z",
        },
      }),
    buildRepoSnapshot: async () => ({
      status: "rate_limited" as const,
      decision: {
        allowed: false as const,
        status: 429 as const,
        code: "snapshot_rate_limited",
        error: "Snapshot build is cooling down",
        reason: "snapshot_build_cooldown_active",
        retryAfterSeconds: 300,
        limit: {
          name: "snapshot_build_cooldown",
          value: 1,
          windowSeconds: 900,
        },
      },
    }),
  });

  const response = await handler(
    buildRepoSnapshotRequest(),
    buildRepoRouteParams()
  );

  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), {
    error: "Snapshot build is cooling down",
    code: "snapshot_rate_limited",
    retryAfterSeconds: 300,
    limit: {
      name: "snapshot_build_cooldown",
      value: 1,
      windowSeconds: 900,
    },
  });
});

test("resolveSnapshotCredentialsForRepo prefers stored snapshot ownership over current repo settings", async () => {
  const { resolveSnapshotCredentialsForRepo } = await loadSnapshotRouteModule();

  const resolved = await resolveSnapshotCredentialsForRepo(
    buildSandboxServiceRouteAuth({
      vercelToken: "platform-token",
      vercelTeamId: "platform-team",
      vercelProjectId: "platform-project",
      userVercelToken: "user-token",
      userVercelTeamId: "user-team",
    }),
    buildSandboxServiceRepo({
      repo: {
        snapshot_billing_source: "user_vercel_project",
        snapshot_billing_project_id: "snapshot-project",
        snapshot_billing_team_id: "snapshot-team",
        sandbox_billing_mode_override: "platform",
        vercel_project_id: "repo-project",
        vercel_team_id: "repo-team",
      },
      workspace: buildSandboxServiceWorkspace({
        sandbox_billing_mode: "platform",
      }),
    })
  );

  assert.deepEqual(resolved, {
    ok: true,
    vercelToken: "user-token",
    vercelTeamId: "snapshot-team",
    vercelProjectId: "snapshot-project",
  });
});

test("resolveSnapshotCredentialsForRepo ignores disabled user billing for legacy snapshots", async () => {
  const { resolveSnapshotCredentialsForRepo } = await loadSnapshotRouteModule();

  const resolved = await resolveSnapshotCredentialsForRepo(
    buildSandboxServiceRouteAuth({
      vercelToken: "platform-token",
      vercelTeamId: "platform-team",
      vercelProjectId: "platform-project",
      userVercelToken: "user-token",
      userVercelTeamId: "user-team",
    }),
    buildSandboxServiceRepo({
      repo: {
        snapshot_billing_source: null,
        snapshot_billing_project_id: null,
        snapshot_billing_team_id: null,
        sandbox_billing_mode_override: "user_vercel_project",
        vercel_project_id: "repo-project",
        vercel_team_id: "repo-team",
      },
      workspace: buildSandboxServiceWorkspace({
        sandbox_billing_mode: "platform",
      }),
    })
  );

  assert.deepEqual(resolved, {
    ok: true,
    vercelToken: "platform-token",
    vercelTeamId: "platform-team",
    vercelProjectId: "platform-project",
  });
});

test("resolveSnapshotCredentialsForRepo fails closed for malformed stored user-owned snapshot ownership", async () => {
  const { resolveSnapshotCredentialsForRepo } = await loadSnapshotRouteModule();

  const resolved = await resolveSnapshotCredentialsForRepo(
    buildSandboxServiceRouteAuth({
      vercelToken: "platform-token",
      vercelTeamId: "platform-team",
      vercelProjectId: "platform-project",
      userVercelToken: "user-token",
      userVercelTeamId: "user-team",
    }),
    buildSandboxServiceRepo({
      repo: {
        snapshot_billing_source: "user_vercel_project",
        snapshot_billing_project_id: null,
        snapshot_billing_team_id: null,
        sandbox_billing_mode_override: "platform",
        vercel_project_id: "repo-project",
        vercel_team_id: "repo-team",
      },
      workspace: buildSandboxServiceWorkspace({
        sandbox_billing_mode: "platform",
      }),
    })
  );

  assert.deepEqual(resolved, {
    ok: false,
    error:
      "Sandbox is missing its stored Vercel project for user-owned billing.",
    status: 400,
  });
});

test("resolveSnapshotCredentialsForRepo blocks platform-billed snapshots for users without platform sandbox access", async () => {
  const { resolveSnapshotCredentialsForRepo } = await loadSnapshotRouteModule();

  const resolved = await resolveSnapshotCredentialsForRepo(
    buildSandboxServiceRouteAuth({
      vercelToken: "platform-token",
      vercelTeamId: "platform-team",
      vercelProjectId: "platform-project",
      allowPlatformSandbox: false,
    }),
    buildSandboxServiceRepo({
      repo: {
        snapshot_billing_source: "platform",
        snapshot_billing_project_id: "platform-project",
        snapshot_billing_team_id: "platform-team",
        sandbox_billing_mode_override: "platform",
      },
      workspace: buildSandboxServiceWorkspace({
        sandbox_billing_mode: "platform",
      }),
    })
  );

  assert.deepEqual(resolved, {
    ok: false,
    error:
      "Hosted sandbox compute requires a positive billing balance. Add funds or choose a plan in Settings > Billing.",
    status: 403,
  });
});

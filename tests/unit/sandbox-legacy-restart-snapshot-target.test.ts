import assert from "node:assert/strict";
import test from "node:test";
import { buildLoadedSandboxRestartRecord } from "./sandbox-record-route-test-harness/record-builders";
import { loadSandboxRestartRouteModule } from "./sandbox-record-route-test-harness/loaders";
import { buildSandboxRouteParams } from "./sandbox-record-route-test-harness";

for (const source of ["platform", "user_vercel_project", null] as const) {
  test(`legacy snapshot ${source ?? "unlabelled"} ownership follows the provider that captured it`, async () => {
    const { createSandboxRestartHandler } =
      await loadSandboxRestartRouteModule();
    const saved = buildLoadedSandboxRestartRecord({
      billing_source: source,
      vercel_project_id: source === null ? null : "stale-project",
      vercel_team_id: source === null ? null : "stale-team",
      billing_project_id: source === null ? null : "saved-project",
      billing_team_id: source === null ? null : "saved-team",
    });
    const expected =
      source === "user_vercel_project"
        ? {
            vercelToken: "user-token",
            vercelProjectId: "saved-project",
            vercelTeamId: "saved-team",
          }
        : {
            vercelToken: "platform-token",
            vercelProjectId: "current-project",
            vercelTeamId: source === null ? null : "current-team",
          };
    const metadata: Record<string, unknown>[] = [];
    const launches: Record<string, unknown>[] = [];
    const handler = createSandboxRestartHandler({
      loadOwnedSandboxRouteRecord: (async () => ({
        ...saved,
        auth: {
          ...saved.auth,
          vercelProjectId: "current-project",
          vercelTeamId: "current-team",
          userVercelToken: "user-token",
        },
        rootDirectory: null,
      })) as never,
      getSandbox: async (_id, credentials) => {
        assert.deepEqual(credentials, expected);
        return {
          snapshot: async () => ({ snapshotId: "saved-snapshot" }),
        } as never;
      },
      updateSandboxRecord: async (_id, updates) => {
        metadata.push(updates);
        return { id: "sandbox-1" } as never;
      },
      stopSandboxRecord: async () => ({ id: "sandbox-1" }) as never,
      fetchImpl: async (_url, init) => {
        launches.push(JSON.parse(String(init?.body)));
        return Response.json({});
      },
    });
    const response = await handler(
      new Request("https://browser.example/api/sandbox", { method: "POST" }),
      buildSandboxRouteParams()
    );
    assert.equal(response.status, 200);
    assert.equal(metadata.length, 1);
    assert.equal(
      metadata[0]?.snapshot_billing_project_id,
      expected.vercelProjectId
    );
    assert.equal(metadata[0]?.snapshot_billing_team_id, expected.vercelTeamId);
    assert.equal(launches.length, 1);
    assert.equal(
      launches[0]?.restoreSnapshotProjectId,
      expected.vercelProjectId
    );
    assert.equal(launches[0]?.restoreSnapshotTeamId, expected.vercelTeamId);
  });
}

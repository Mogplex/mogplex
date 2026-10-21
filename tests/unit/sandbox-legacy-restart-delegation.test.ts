import assert from "node:assert/strict";
import test from "node:test";
import { buildLoadedSandboxRestartRecord } from "./sandbox-record-route-test-harness/record-builders";
import { loadSandboxRestartRouteModule } from "./sandbox-record-route-test-harness/loaders";
import {
  buildResolvedSandboxRouteContext,
  buildSandboxRouteParams,
} from "./sandbox-record-route-test-harness";

const TEAM_ID = "00000000-0000-4000-8000-000000000456";

for (const [host, root] of [
  ["mogplex.internal", "apps/web"],
  ["internal.mogplex", null],
] as const) {
  test(`legacy restart from ${host} preserves delegated team and root at the configured app origin`, async () => {
    const previousUrl = process.env.APP_URL;
    process.env.APP_URL = "https://configured-app.example";
    const { createSandboxRestartHandler } =
      await loadSandboxRestartRouteModule();
    const captured: Array<{
      url: string;
      headers: Headers;
      body: Record<string, unknown>;
    }> = [];
    const handler = createSandboxRestartHandler({
      loadOwnedSandboxRouteRecord: (async () => ({
        ...buildLoadedSandboxRestartRecord(),
        rootDirectory: root,
      })) as never,
      resolveLoadedSandboxRouteContext: async (loaded) =>
        buildResolvedSandboxRouteContext(loaded) as never,
      getSandbox: async () =>
        ({ snapshot: async () => ({ snapshotId: "saved-snapshot" }) }) as never,
      stopSandboxRecord: async () => ({ id: "sandbox-1" }) as never,
      updateSandboxRecord: async () => ({ id: "sandbox-1" }) as never,
      fetchImpl: async (input, init) => {
        captured.push({
          url: String(input),
          headers: new Headers(init?.headers),
          body: JSON.parse(String(init?.body)),
        });
        return Response.json({ sandbox: { id: "restored-workspace" } });
      },
    });
    try {
      const response = await handler(
        new Request(`https://${host}/api/sandbox`, {
          method: "POST",
          headers: {
            authorization: "Bearer internal-test-secret",
            "x-delegated-user-id": "user-1",
            "x-mogplex-team-id": TEAM_ID,
          },
        }),
        buildSandboxRouteParams()
      );
      assert.equal(response.status, 200);
      assert.equal(captured.length, 1);
      assert.equal(
        captured[0]?.url,
        "https://configured-app.example/api/sandbox"
      );
      assert.equal(captured[0]?.headers.get("x-mogplex-team-id"), TEAM_ID);
      assert.equal(captured[0]?.headers.get("x-delegated-user-id"), "user-1");
      assert.equal(
        captured[0]?.headers.get("authorization"),
        "Bearer internal-test-secret"
      );
      assert.equal(captured[0]?.body.rootDirectory, root);
      assert.equal(captured[0]?.body.restoreSnapshotId, "saved-snapshot");
    } finally {
      if (previousUrl === undefined) delete process.env.APP_URL;
      else process.env.APP_URL = previousUrl;
    }
  });
}

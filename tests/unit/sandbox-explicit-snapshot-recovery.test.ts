import assert from "node:assert/strict";
import test from "node:test";

for (const restoreSnapshotId of ["saved-workspace", "cached-snapshot", null]) {
  test(`snapshot restore ${restoreSnapshotId ?? "cache"} failure preserves the explicit recovery boundary`, async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
    const previousBackend = process.env.MOGPLEX_DATA_BACKEND;
    process.env.MOGPLEX_DATA_BACKEND = "supabase";
    const { restoreSandboxFromSnapshotIfAvailable } =
      await import("../../app/api/sandbox/_lib/provisioning");
    const originalFetch = globalThis.fetch;
    const originalWarn = console.warn;
    const originalError = console.error;
    let metadataWrites = 0;
    globalThis.fetch = async (input, init) => {
      assert.equal(new URL(String(input)).pathname, "/rest/v1/repos");
      assert.equal(init?.method, "PATCH");
      metadataWrites++;
      return Response.json({ id: "repo-1" });
    };
    console.warn = () => {};
    console.error = () => {};
    try {
      const operation = restoreSandboxFromSnapshotIfAvailable({
        deps: {
          createSandboxFromSnapshot: async () => {
            throw new Error("Private provider outage");
          },
        } as never,
        launch: {
          repoId: "repo-1",
          repo: { snapshot_id: "cached-snapshot" },
          launchRequest: { restoreSnapshotId, restoreSnapshotProjectId: null },
          sandboxSource: { kind: "snapshot", snapshotId: "cached-snapshot" },
          createContext: {
            credentials: {
              vercelToken: "test-token",
              vercelProjectId: "project-1",
              vercelTeamId: null,
            },
          },
          runtime: "node22",
          configuredDevPort: 3000,
          effectiveSandboxTimeoutMs: 300000,
        } as never,
        environment: {
          envResolution: { envVars: {} },
          networkPolicy: {},
        } as never,
        emit: () => {},
        sandboxRecordId: "sandbox-1",
      });
      if (restoreSnapshotId) {
        await assert.rejects(operation, (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.match(error.message, /Saved workspace could not be restored/);
          assert.doesNotMatch(error.message, /Private provider/);
          return true;
        });
        assert.equal(
          metadataWrites,
          0,
          "keep the saved reference, even when it is also the repo cache"
        );
      } else {
        const result = await operation;
        assert.equal(result.sandbox, null);
        assert.equal(result.shouldQueueDeferredSnapshot, true);
        assert.equal(
          metadataWrites,
          1,
          "an optional cache can be invalidated for a normal checkout"
        );
      }
    } finally {
      globalThis.fetch = originalFetch;
      console.warn = originalWarn;
      console.error = originalError;
      if (previousBackend === undefined)
        delete process.env.MOGPLEX_DATA_BACKEND;
      else process.env.MOGPLEX_DATA_BACKEND = previousBackend;
    }
  });
}

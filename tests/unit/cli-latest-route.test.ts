import assert from "node:assert/strict";
import test from "node:test";

async function loadRoute() {
  return import("../../app/api/cli/latest/route");
}

async function withPatchedFetch<T>(
  impl: typeof fetch,
  callback: () => Promise<T>
) {
  const originalFetch = global.fetch;
  Object.defineProperty(global, "fetch", {
    configurable: true,
    writable: true,
    value: impl,
  });

  try {
    return await callback();
  } finally {
    Object.defineProperty(global, "fetch", {
      configurable: true,
      writable: true,
      value: originalFetch,
    });
  }
}

test("GET /api/cli/latest proxies the canonical manifest and preserves no-store", async () => {
  const { GET } = await loadRoute();

  await withPatchedFetch(
    async () =>
      Response.json({
        version: "0.1.0",
        releaseTag: "v0.1.0",
        baseUrl: "https://install.mogplex.com/releases",
        generatedAt: "2026-04-22T00:00:00.000Z",
        assets: [
          {
            target: "windows-x64",
            archiveName: "mogplex-windows-x64.zip",
            archiveFormat: "zip",
            archiveUrl:
              "https://install.mogplex.com/releases/v0.1.0/mogplex-windows-x64.zip",
            sha256: "ghi789",
          },
        ],
      }),
    async () => {
      const response = await GET();

      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.deepEqual(await response.json(), {
        version: "0.1.0",
        releaseTag: "v0.1.0",
        baseUrl: "https://install.mogplex.com/releases",
        generatedAt: "2026-04-22T00:00:00.000Z",
        installScriptUrl: "https://install.mogplex.com/install.sh",
        assets: [
          {
            target: "windows-x64",
            archiveName: "mogplex-windows-x64.zip",
            archiveFormat: "zip",
            archiveUrl:
              "https://install.mogplex.com/releases/v0.1.0/mogplex-windows-x64.zip",
            sha256: "ghi789",
          },
        ],
      });
    }
  );
});

test("GET /api/cli/latest returns 503 when the canonical manifest is unavailable", async () => {
  const { GET } = await loadRoute();

  await withPatchedFetch(
    async () => new Response(null, { status: 503 }),
    async () => {
      const response = await GET();

      assert.equal(response.status, 503);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.deepEqual(await response.json(), {
        error: "CLI release manifest is unavailable",
        installScriptUrl: "https://install.mogplex.com/install.sh",
      });
    }
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  CANONICAL_CLI_INSTALL_SCRIPT_URL,
  CANONICAL_CLI_MANIFEST_URL,
  fetchCliReleaseManifest,
  normalizeCliReleaseManifest,
} from "../../lib/cli-release";

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

test("normalizeCliReleaseManifest accepts the canonical manifest shape and adds installScriptUrl", () => {
  const manifest = normalizeCliReleaseManifest({
    version: "0.1.0",
    releaseTag: "v0.1.0",
    baseUrl: "https://install.mogplex.com/releases",
    generatedAt: "2026-04-22T00:00:00.000Z",
    assets: [
      {
        target: "macos-arm64",
        archiveName: "mogplex-macos-arm64.zip",
        archiveFormat: "zip",
        archiveUrl:
          "https://install.mogplex.com/releases/v0.1.0/mogplex-macos-arm64.zip",
        sha256: "abc123",
      },
    ],
  });

  assert.deepEqual(manifest, {
    version: "0.1.0",
    releaseTag: "v0.1.0",
    baseUrl: "https://install.mogplex.com/releases",
    generatedAt: "2026-04-22T00:00:00.000Z",
    installScriptUrl: CANONICAL_CLI_INSTALL_SCRIPT_URL,
    assets: [
      {
        target: "macos-arm64",
        archiveName: "mogplex-macos-arm64.zip",
        archiveFormat: "zip",
        archiveUrl:
          "https://install.mogplex.com/releases/v0.1.0/mogplex-macos-arm64.zip",
        sha256: "abc123",
      },
    ],
  });
});

test("normalizeCliReleaseManifest rejects malformed manifests", () => {
  assert.equal(
    normalizeCliReleaseManifest({
      version: "0.1.0",
      releaseTag: "v0.1.0",
      baseUrl: "https://install.mogplex.com/releases",
      assets: [],
    }),
    null
  );
  assert.equal(
    normalizeCliReleaseManifest({
      version: "0.1.0",
      releaseTag: "v0.1.0",
      baseUrl: "https://install.mogplex.com/releases",
      assets: [
        {
          target: "macos-arm64",
          archiveName: "mogplex-macos-arm64.zip",
        },
      ],
    }),
    null
  );
});

test("fetchCliReleaseManifest reads the canonical latest.json manifest", async () => {
  await withPatchedFetch(
    async (input, init) => {
      assert.equal(input, CANONICAL_CLI_MANIFEST_URL);
      assert.deepEqual(init, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      return Response.json({
        version: "0.1.0",
        releaseTag: "v0.1.0",
        baseUrl: "https://install.mogplex.com/releases",
        assets: [
          {
            target: "linux-x64",
            archiveName: "mogplex-linux-x64.tar.gz",
            archiveFormat: "tar.gz",
            archiveUrl:
              "https://install.mogplex.com/releases/v0.1.0/mogplex-linux-x64.tar.gz",
            sha256: "def456",
          },
        ],
      });
    },
    async () => {
      const manifest = await fetchCliReleaseManifest();

      assert.deepEqual(manifest, {
        version: "0.1.0",
        releaseTag: "v0.1.0",
        baseUrl: "https://install.mogplex.com/releases",
        generatedAt: undefined,
        installScriptUrl: CANONICAL_CLI_INSTALL_SCRIPT_URL,
        assets: [
          {
            target: "linux-x64",
            archiveName: "mogplex-linux-x64.tar.gz",
            archiveFormat: "tar.gz",
            archiveUrl:
              "https://install.mogplex.com/releases/v0.1.0/mogplex-linux-x64.tar.gz",
            sha256: "def456",
          },
        ],
      });
    }
  );
});

test("fetchCliReleaseManifest returns null for non-200 or malformed payloads", async () => {
  await withPatchedFetch(
    async () => new Response(null, { status: 503 }),
    async () => {
      assert.equal(await fetchCliReleaseManifest(), null);
    }
  );

  await withPatchedFetch(
    async () =>
      Response.json({
        version: "0.1.0",
        releaseTag: "v0.1.0",
        baseUrl: "https://install.mogplex.com/releases",
        assets: [],
      }),
    async () => {
      assert.equal(await fetchCliReleaseManifest(), null);
    }
  );
});

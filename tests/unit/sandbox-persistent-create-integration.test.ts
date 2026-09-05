import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

// Tests need to swap Sandbox.create at the module level to observe
// what createSandboxForRepo passes to the SDK. createRequire is the
// cleanest way to do that from an ESM test file without adding a
// test-only dependency-injection seam to production code.
const nodeRequire = createRequire(import.meta.url);

/**
 * Integration-level test: createSandboxForRepo / createSandboxFromSnapshot
 * must pass persistent + a sensible snapshotExpiration to the
 * underlying Sandbox.create call. The ENABLE/DISABLE env flags and
 * provider permission failures interact with this plumbing, so exercise
 * them here too.
 */

async function loadWithSdkMock(
  mockCreate: (opts: unknown) => Promise<unknown>
) {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  const sdk = nodeRequire(
    "@vercel/sandbox"
  ) as typeof import("@vercel/sandbox");
  const originalCreate = sdk.Sandbox.create;
  (sdk.Sandbox as unknown as { create: typeof mockCreate }).create = mockCreate;

  // Force a fresh import of our client so it picks up the patched SDK.
  const clientPath = nodeRequire.resolve("../../lib/sandbox/client");
  delete nodeRequire.cache[clientPath];
  const client = nodeRequire(
    clientPath
  ) as typeof import("../../lib/sandbox/client");

  return {
    client,
    restore: () => {
      (sdk.Sandbox as unknown as { create: typeof originalCreate }).create =
        originalCreate;
    },
  };
}

function withEnv<T>(
  vars: Record<string, string | undefined>,
  fn: () => Promise<T>
): Promise<T> {
  const prev: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    prev[key] = process.env[key];
    if (vars[key] === undefined) delete process.env[key];
    else process.env[key] = vars[key];
  }
  const restore = () => {
    for (const key of Object.keys(prev)) {
      if (prev[key] === undefined) delete process.env[key];
      else process.env[key] = prev[key];
    }
  };
  return fn().finally(restore);
}

test("createSandboxForRepo passes persistent:true + 7d snapshotExpiration + name to Sandbox.create when ENABLE=true", async () => {
  await withEnv(
    {
      ENABLE_PERSISTENT_SANDBOXES: "true",
      DISABLE_PERSISTENT_SANDBOXES: undefined,
    },
    async () => {
      const received: Array<Record<string, unknown>> = [];
      const mockCreate = async (opts: unknown) => {
        received.push(opts as Record<string, unknown>);
        return { name: "mock-sandbox" } as never;
      };
      const { client, restore } = await loadWithSdkMock(mockCreate);
      try {
        await client.createSandboxForRepo({
          vercelToken: "t",
          vercelProjectId: "p",
          githubToken: "g",
          repoFullName: "owner/repo",
          name: "mogplex-abc-main-def",
        });
      } finally {
        restore();
      }
      assert.equal(received.length, 1);
      const first = received[0];
      assert.equal(first.persistent, true);
      assert.equal(first.snapshotExpiration, 7 * 24 * 60 * 60 * 1000);
      assert.equal(first.name, "mogplex-abc-main-def");
    }
  );
});

test("createSandboxForRepo ships persistent:false when ENABLE is unset (plan default)", async () => {
  await withEnv(
    {
      ENABLE_PERSISTENT_SANDBOXES: undefined,
      DISABLE_PERSISTENT_SANDBOXES: undefined,
    },
    async () => {
      const received: Array<Record<string, unknown>> = [];
      const mockCreate = async (opts: unknown) => {
        received.push(opts as Record<string, unknown>);
        return { name: "mock-sandbox" } as never;
      };
      const { client, restore } = await loadWithSdkMock(mockCreate);
      try {
        await client.createSandboxForRepo({
          vercelToken: "t",
          vercelProjectId: "p",
          githubToken: "g",
          repoFullName: "owner/repo",
        });
      } finally {
        restore();
      }
      assert.equal(received.length, 1);
      assert.equal(received[0].persistent, false);
    }
  );
});

test("createSandboxForRepo rejects a 403 without creating an ephemeral replacement", async () => {
  await withEnv(
    {
      ENABLE_PERSISTENT_SANDBOXES: "true",
      DISABLE_PERSISTENT_SANDBOXES: undefined,
    },
    async () => {
      const received: Array<Record<string, unknown>> = [];
      let attempt = 0;
      const mockCreate = async (opts: unknown) => {
        received.push(opts as Record<string, unknown>);
        attempt += 1;
        if (attempt === 1) {
          const err = new Error(
            "Persistent sandboxes feature is not enabled for this project"
          );
          (err as unknown as { status: number }).status = 403;
          throw err;
        }
        return { name: "mock-sandbox" } as never;
      };
      const { client, restore } = await loadWithSdkMock(mockCreate);
      try {
        await assert.rejects(
          () =>
            client.createSandboxForRepo({
              vercelToken: "t",
              vercelProjectId: "p",
              githubToken: "g",
              repoFullName: "owner/repo",
            }),
          /Persistent sandboxes feature is not enabled/
        );
      } finally {
        restore();
      }
      assert.equal(
        received.length,
        1,
        "must not downgrade required persistence"
      );
      assert.equal(received[0].persistent, true);
    }
  );
});

test("createSandboxForRepo does NOT retry on non-permission errors", async () => {
  await withEnv(
    {
      ENABLE_PERSISTENT_SANDBOXES: "true",
      DISABLE_PERSISTENT_SANDBOXES: undefined,
    },
    async () => {
      let attempt = 0;
      const mockCreate = async () => {
        attempt += 1;
        throw new Error("connection reset by peer");
      };
      const { client, restore } = await loadWithSdkMock(mockCreate);
      try {
        await assert.rejects(
          () =>
            client.createSandboxForRepo({
              vercelToken: "t",
              vercelProjectId: "p",
              githubToken: "g",
              repoFullName: "owner/repo",
            }),
          /connection reset by peer/
        );
      } finally {
        restore();
      }
      assert.equal(attempt, 1, "expected no retry on non-permission error");
    }
  );
});

test("createSandboxForRepo rejects reserved ports before calling Sandbox.create", async () => {
  await withEnv(
    {
      ENABLE_PERSISTENT_SANDBOXES: undefined,
      DISABLE_PERSISTENT_SANDBOXES: undefined,
    },
    async () => {
      let createCalls = 0;
      const mockCreate = async () => {
        createCalls += 1;
        return { name: "mock-sandbox" } as never;
      };
      const { client, restore } = await loadWithSdkMock(mockCreate);
      try {
        await assert.rejects(
          () =>
            client.createSandboxForRepo({
              vercelToken: "t",
              vercelProjectId: "p",
              githubToken: "g",
              repoFullName: "owner/repo",
              devPort: 8080,
            }),
          (err: unknown) => {
            assert.ok(
              err instanceof client.SandboxCreateRequestValidationError
            );
            assert.equal(err.code, "reserved_port");
            assert.match(err.message, /reserved port 8080/i);
            return true;
          }
        );
      } finally {
        restore();
      }
      assert.equal(createCalls, 0, "expected no SDK calls for reserved ports");
    }
  );
});

test("createSandboxForRepo rejects oversized env payloads before calling Sandbox.create", async () => {
  await withEnv(
    {
      ENABLE_PERSISTENT_SANDBOXES: undefined,
      DISABLE_PERSISTENT_SANDBOXES: undefined,
    },
    async () => {
      let createCalls = 0;
      const mockCreate = async () => {
        createCalls += 1;
        return { name: "mock-sandbox" } as never;
      };
      const { client, restore } = await loadWithSdkMock(mockCreate);
      try {
        await assert.rejects(
          () =>
            client.createSandboxForRepo({
              vercelToken: "t",
              vercelProjectId: "p",
              githubToken: "g",
              repoFullName: "owner/repo",
              envVars: {
                HUGE_ALPHA: "a".repeat(2600),
                HUGE_BRAVO: "b".repeat(1800),
              },
            }),
          (err: unknown) => {
            assert.ok(
              err instanceof client.SandboxCreateRequestValidationError
            );
            assert.equal(err.code, "env_payload_too_large");
            assert.match(err.message, /max 4096/i);
            assert.match(err.message, /HUGE_ALPHA/i);
            assert.match(err.message, /HUGE_BRAVO/i);
            return true;
          }
        );
      } finally {
        restore();
      }
      assert.equal(
        createCalls,
        0,
        "expected no SDK calls for oversized env payloads"
      );
    }
  );
});

test("createSandboxFromSnapshot applies the same create-time validation before calling Sandbox.create", async () => {
  await withEnv(
    {
      ENABLE_PERSISTENT_SANDBOXES: undefined,
      DISABLE_PERSISTENT_SANDBOXES: undefined,
    },
    async () => {
      let createCalls = 0;
      const mockCreate = async () => {
        createCalls += 1;
        return { name: "mock-sandbox" } as never;
      };
      const { client, restore } = await loadWithSdkMock(mockCreate);
      try {
        await assert.rejects(
          () =>
            client.createSandboxFromSnapshot({
              vercelToken: "t",
              vercelProjectId: "p",
              snapshotId: "snap_123",
              devPort: 8080,
            }),
          (err: unknown) => {
            assert.ok(
              err instanceof client.SandboxCreateRequestValidationError
            );
            assert.equal(err.code, "reserved_port");
            return true;
          }
        );
      } finally {
        restore();
      }
      assert.equal(
        createCalls,
        0,
        "expected no SDK calls for snapshot validation failures"
      );
    }
  );
});

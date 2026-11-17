import assert from "node:assert/strict";
import test from "node:test";
import {
  createSigningVerificationHandler,
  type SigningVerificationDeps,
} from "../../app/api/sandbox/[id]/commit-signing/route";
import type { SandboxRunCommandParams } from "../../lib/sandbox/provider/types";

const id = "00000000-0000-4000-8000-000000000777";
const key = {
  publicKey: "ssh-ed25519 AAAA comment",
  fingerprint: "SHA256:fixture",
  title: null,
  githubKeyId: null,
  registeredAt: null,
  createdAt: "2026-11-17T00:00:00Z",
};
function fixture(overrides: Partial<SigningVerificationDeps> = {}) {
  const commands: SandboxRunCommandParams[] = [];
  const checks: unknown[] = [];
  let status = "running";
  const deps: SigningVerificationDeps = {
    loadContext: async (_request, sandboxId, options) => {
      checks.push({ sandboxId, ...options });
      return {
        ok: true,
        auth: { userId: "owner" },
        rootDirectory: "apps/web",
        sandbox: {
          currentSession: () => ({
            status,
            runCommand: async (command) => {
              commands.push(command);
              return { exitCode: 0 };
            },
          }),
        },
      };
    },
    loadKey: async (userId) => {
      assert.equal(userId, "owner");
      return key;
    },
    ...overrides,
  };
  const post = (recordId = id) =>
    createSigningVerificationHandler(deps)(
      new Request("http://localhost/verify", { method: "POST" }),
      { params: Promise.resolve({ id: recordId }) }
    );
  return {
    commands,
    checks,
    post,
    setStatus: (value: string) => {
      status = value;
    },
    pause: () => {
      status = "stopped";
    },
  };
}

test("requires an owned capability-gated workspace and verifies only its current session", async () => {
  const f = fixture();
  const response = await f.post();
  const body = await response.json();
  assert.equal(body.status, "verified");
  assert.equal(body.fingerprint, key.fingerprint);
  assert.equal(f.commands.length, 1);
  assert.ok(f.commands[0].signal instanceof AbortSignal);
  assert.equal(f.commands[0].cwd, "/vercel/sandbox/apps/web");
  assert.equal(f.commands[0].args?.at(-1), "ssh-ed25519 AAAA");
  assert.deepEqual(f.checks, [
    {
      sandboxId: id,
      select:
        "id,sandbox_id,root_directory,billing_source,billing_team_id,billing_project_id,vercel_team_id,vercel_project_id,repo:repos(root_directory)",
      requireCapability: "tools.bash",
    },
  ]);
  f.pause();
  assert.equal((await (await f.post()).json()).status, "paused");
  assert.equal(f.commands.length, 1);
});

test("invalid, unauthorized, foreign, and missing-key requests never run commands", async () => {
  const invalid = fixture();
  assert.equal((await invalid.post("bad-id")).status, 400);
  assert.deepEqual(invalid.checks, []);
  for (const status of [401, 403, 404]) {
    const f = fixture({
      loadContext: async () => ({ ok: false, status, error: "Unavailable" }),
    });
    assert.equal((await f.post()).status, status);
    assert.equal(f.commands.length, 0);
  }
  const absent = fixture({ loadKey: async () => null });
  assert.equal((await absent.post()).status, 409);
  assert.equal(absent.commands.length, 0);
});

test("a concurrently replaced key cannot receive an earlier key's successful receipt", async () => {
  let reads = 0;
  const f = fixture({
    loadKey: async () =>
      ++reads === 1 ? key : { ...key, publicKey: "ssh-ed25519 NEW" },
  });
  const response = await f.post();
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /changed during verification/);
});

test("provider failures remain retryable and do not echo secret-bearing messages", async () => {
  const f = fixture({
    loadContext: async () => {
      throw new Error("private-provider-detail");
    },
  });
  const response = await f.post();
  assert.equal(response.status, 503);
  const body = await response.text();
  assert.match(body, /Try again/);
  assert.doesNotMatch(body, /private-provider-detail/);
});

test("pending and transitioning workspaces do not receive misleading resume advice", async () => {
  const f = fixture();
  for (const status of ["pending", "stopping", "snapshotting", "failed"]) {
    f.setStatus(status);
    const body = await (await f.post()).json();
    assert.equal(body.status, "not_running");
    assert.doesNotMatch(body.message, /Resume/);
  }
  assert.equal(f.commands.length, 0);
});

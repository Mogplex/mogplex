import assert from "node:assert/strict";
import test from "node:test";
import {
  __resetLockfileHashCacheForTests,
  computeLockfileHashFromSandbox,
  fetchLockfileHashFromGithub,
  hashLockfileBytes,
} from "../../lib/sandbox/lockfile-hash";

type ReadFileCall = { path: string };

type SandboxStub = {
  readFileToBuffer: (call: ReadFileCall) => Promise<Buffer | null>;
};

function makeSandboxStub(
  files: Record<string, Buffer | null | undefined>
): SandboxStub {
  return {
    readFileToBuffer: async ({ path }) => {
      const value = files[path];
      if (value === undefined) return null;
      if (value === null) return null;
      return value;
    },
  };
}

test("hashLockfileBytes is stable for identical input", () => {
  const a = hashLockfileBytes(Buffer.from("lockfile contents"));
  const b = hashLockfileBytes(Buffer.from("lockfile contents"));
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test("hashLockfileBytes differs for different input", () => {
  const a = hashLockfileBytes(Buffer.from("one"));
  const b = hashLockfileBytes(Buffer.from("two"));
  assert.notEqual(a, b);
});

test("computeLockfileHashFromSandbox picks pnpm over yarn when both exist", async () => {
  const sandbox = makeSandboxStub({
    "pnpm-lock.yaml": Buffer.from("pnpm-bytes"),
    "yarn.lock": Buffer.from("yarn-bytes"),
  });

  const result = await computeLockfileHashFromSandbox(
    sandbox as unknown as Parameters<typeof computeLockfileHashFromSandbox>[0]
  );
  assert.ok(result, "expected result");
  assert.equal(result.packageManager, "pnpm");
  assert.equal(result.lockfilePath, "pnpm-lock.yaml");
  assert.equal(result.hash, hashLockfileBytes(Buffer.from("pnpm-bytes")));
});

test("computeLockfileHashFromSandbox falls back to repo root when rootDir has no lockfile", async () => {
  const sandbox = makeSandboxStub({
    "apps/web/pnpm-lock.yaml": null,
    "pnpm-lock.yaml": Buffer.from("root-lockfile"),
  });

  const result = await computeLockfileHashFromSandbox(
    sandbox as unknown as Parameters<typeof computeLockfileHashFromSandbox>[0],
    "apps/web"
  );
  assert.ok(result, "expected result");
  assert.equal(result.lockfilePath, "pnpm-lock.yaml");
  assert.equal(result.packageManager, "pnpm");
});

test("computeLockfileHashFromSandbox returns null when no lockfile exists", async () => {
  const sandbox = makeSandboxStub({});
  const result = await computeLockfileHashFromSandbox(
    sandbox as unknown as Parameters<typeof computeLockfileHashFromSandbox>[0]
  );
  assert.equal(result, null);
});

test("fetchLockfileHashFromGithub returns hash on 200 and caches within TTL", async () => {
  __resetLockfileHashCacheForTests();
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => {
    calls.push(url);
    return new Response("fake-lock-contents", {
      status: 200,
      statusText: "OK",
    });
  }) as unknown as typeof fetch;

  const first = await fetchLockfileHashFromGithub({
    repoFullName: "owner/repo",
    ref: "main",
    token: "t",
    fetchImpl,
  });
  const second = await fetchLockfileHashFromGithub({
    repoFullName: "owner/repo",
    ref: "main",
    token: "t",
    fetchImpl,
  });

  assert.ok(first);
  assert.equal(first.packageManager, "pnpm");
  assert.equal(
    first.hash,
    hashLockfileBytes(Buffer.from("fake-lock-contents"))
  );
  assert.deepEqual(first, second);
  assert.equal(calls.length, 1, "second call should hit cache");
});

test("fetchLockfileHashFromGithub probes lockfiles in priority order", async () => {
  __resetLockfileHashCacheForTests();
  const probed: string[] = [];
  const fetchImpl = (async (url: string) => {
    probed.push(url);
    if (url.includes("pnpm-lock.yaml")) {
      return new Response("", { status: 404, statusText: "Not Found" });
    }
    if (url.includes("yarn.lock")) {
      return new Response("yarn-contents", { status: 200, statusText: "OK" });
    }
    return new Response("", { status: 404, statusText: "Not Found" });
  }) as unknown as typeof fetch;

  const result = await fetchLockfileHashFromGithub({
    repoFullName: "owner/repo",
    ref: "feat/a",
    token: "t",
    fetchImpl,
  });

  assert.ok(result);
  assert.equal(result.packageManager, "yarn");
  assert.equal(probed.length, 2);
  assert.ok(probed[0].includes("pnpm-lock.yaml"));
  assert.ok(probed[1].includes("yarn.lock"));
});

test("fetchLockfileHashFromGithub returns null when all lockfiles 404", async () => {
  __resetLockfileHashCacheForTests();
  const fetchImpl = (async () =>
    new Response("", {
      status: 404,
      statusText: "Not Found",
    })) as unknown as typeof fetch;

  const result = await fetchLockfileHashFromGithub({
    repoFullName: "owner/repo",
    ref: "main",
    token: "t",
    fetchImpl,
  });

  assert.equal(result, null);
});

test("fetchLockfileHashFromGithub propagates non-404 errors", async () => {
  __resetLockfileHashCacheForTests();
  const fetchImpl = (async () =>
    new Response("rate limited", {
      status: 403,
      statusText: "Forbidden",
    })) as unknown as typeof fetch;

  await assert.rejects(
    fetchLockfileHashFromGithub({
      repoFullName: "owner/repo",
      ref: "main",
      token: "t",
      fetchImpl,
    }),
    /GitHub lockfile fetch failed: 403/
  );
});

test("fetchLockfileHashFromGithub expires cache entries after TTL", async () => {
  __resetLockfileHashCacheForTests();
  let callCount = 0;
  const fetchImpl = (async () => {
    callCount += 1;
    return new Response("body", { status: 200, statusText: "OK" });
  }) as unknown as typeof fetch;

  let clock = 1000;
  const now = () => clock;

  await fetchLockfileHashFromGithub({
    repoFullName: "owner/repo",
    ref: "main",
    token: "t",
    ttlMs: 100,
    now,
    fetchImpl,
  });
  clock += 500; // > ttl
  await fetchLockfileHashFromGithub({
    repoFullName: "owner/repo",
    ref: "main",
    token: "t",
    ttlMs: 100,
    now,
    fetchImpl,
  });

  assert.equal(callCount, 2);
});

test("fetchLockfileHashFromGithub encodes ref and path correctly", async () => {
  __resetLockfileHashCacheForTests();
  let capturedUrl = "";
  const fetchImpl = (async (url: string) => {
    capturedUrl = url;
    return new Response("body", { status: 200, statusText: "OK" });
  }) as unknown as typeof fetch;

  await fetchLockfileHashFromGithub({
    repoFullName: "owner/my repo",
    ref: "feat/branch with spaces",
    token: "t",
    fetchImpl,
  });

  assert.ok(capturedUrl.includes("pnpm-lock.yaml"));
  assert.ok(capturedUrl.includes("feat%2Fbranch%20with%20spaces"));
});

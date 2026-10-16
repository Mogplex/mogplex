import assert from "node:assert/strict";
import test from "node:test";
import type { Sandbox } from "@vercel/sandbox";
import {
  createVercelSandboxProvider,
  type VercelSandboxDeps,
} from "../../lib/sandbox/provider/vercel/vercel-provider";

type ListResult = Awaited<ReturnType<VercelSandboxDeps["listVercelSandboxes"]>>;

const CREDS = { vercelToken: "test-token", vercelProjectId: "prj_test" };
const NOT_FOUND = new Error("sandbox not found");
const fakeSandbox = { name: "sbx-1" } as unknown as Sandbox;

function unexpected(): never {
  throw new Error("unexpected call");
}

function buildProvider(overrides: Partial<VercelSandboxDeps>) {
  return createVercelSandboxProvider({
    createSandboxForRepo: unexpected,
    createSandboxFromSnapshot: unexpected,
    getSandbox: unexpected,
    listVercelSandboxes: unexpected,
    isNotFoundError: (error) => error === NOT_FOUND,
    ...overrides,
  });
}

test("get should leave a stopped sandbox stopped when resume is not requested", async () => {
  const resumes: unknown[] = [];
  const provider = buildProvider({
    getSandbox: async (_name, _creds, opts) => {
      resumes.push(opts?.resume);
      return fakeSandbox;
    },
  });

  await provider.get("sbx-1", CREDS);
  await provider.get("sbx-1", CREDS, { resume: true });

  assert.deepEqual(resumes, [false, true]);
});

test("getIfExists should return null when the sandbox does not exist", async () => {
  const provider = buildProvider({
    getSandbox: async () => {
      throw NOT_FOUND;
    },
  });

  assert.equal(await provider.getIfExists("missing", CREDS), null);
});

test("getIfExists should rethrow errors other than not-found", async () => {
  const outage = new Error("upstream 503");
  const provider = buildProvider({
    getSandbox: async () => {
      throw outage;
    },
  });

  await assert.rejects(provider.getIfExists("sbx-1", CREDS), outage);
});

test("list should map SDK rows to summaries and omit absent tags", async () => {
  const rows = [
    {
      name: "a",
      status: "running",
      persistent: true,
      createdAt: 1,
      tags: { repo: "r1" },
      memory: 2048,
    },
    { name: "b", status: "stopped", persistent: false, createdAt: 2 },
  ] as unknown as ListResult;
  const provider = buildProvider({ listVercelSandboxes: async () => rows });

  assert.deepEqual(await provider.list(CREDS, { limit: 2 }), [
    {
      name: "a",
      status: "running",
      persistent: true,
      createdAt: 1,
      tags: { repo: "r1" },
    },
    { name: "b", status: "stopped", persistent: false, createdAt: 2 },
  ]);
});

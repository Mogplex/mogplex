import assert from "node:assert/strict";
import test from "node:test";
import { buildPersistedPersistentRestartRecord } from "./helpers/sandbox-restart-route-fixtures";
import { buildSandboxName } from "../../lib/sandbox/sandbox-name";

const TEAM_ID = "00000000-0000-4000-8000-000000000456";
const REPO_ID = "00000000-0000-4000-8000-000000000123";
const identity = { userId: "user-1", repoId: REPO_ID, workingBranch: "main" };
type StoredSandbox = ReturnType<
  typeof buildPersistedPersistentRestartRecord
> & {
  product_team_id: string | null;
};

async function withSavedWorkspaces(
  runTest: (fixture: {
    legacy: StoredSandbox;
    records: StoredSandbox[];
    deps: ReturnType<
      (typeof import("../../app/api/v1/mogplex/sandboxes/_lib/launch-deps"))["createMogplexApiSandboxPostDeps"]
    >;
    providerNames: string[];
  }) => Promise<void>
) {
  process.env.MOGPLEX_DATA_BACKEND = "supabase";
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  const legacy = {
    ...buildPersistedPersistentRestartRecord({
      id: "saved-personal-workspace",
      user_id: identity.userId,
      repo_id: REPO_ID,
      working_branch: "main",
      sandbox_id: buildSandboxName({ ...identity, rootDirectory: null }),
      status: "stopped",
    }),
    product_team_id: null,
  };
  const records: StoredSandbox[] = [legacy];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, "/rest/v1/sandboxes");
    const found = records.filter(
      (record) =>
        [
          "repo_id",
          "user_id",
          "working_branch",
          "sandbox_id",
          "root_directory",
          "product_team_id",
        ].every((key) => {
          const filter = url.searchParams.get(key);
          if (!filter) return true;
          const value = record[key as keyof StoredSandbox];
          return filter === "is.null"
            ? value === null
            : filter === `eq.${value}`;
        }) &&
        (url.searchParams.get("status") ?? "").includes(String(record.status))
    );
    return Response.json(
      url.searchParams.has("sandbox_id") ? (found[0] ?? null) : found
    );
  };
  try {
    const { createMogplexApiSandboxPostDeps } =
      await import("../../app/api/v1/mogplex/sandboxes/_lib/launch-deps");
    const { resolveNameCollision } = await import("../../lib/sandbox/launch");
    const providerNames: string[] = [];
    const deps = createMogplexApiSandboxPostDeps({
      resolveNameCollision: (input) =>
        resolveNameCollision(input, {
          getSandbox: async (name) => {
            providerNames.push(name);
            if (!records.some((record) => record.sandbox_id === name)) {
              throw new Error("Scoped provider probe failed");
            }
            return { status: "stopped", persistent: true } as never;
          },
          findNamedSandbox: async () => {
            throw new Error("Must not discard saved work");
          },
          deleteSandbox: async () => {
            throw new Error("Must not delete saved work");
          },
          deleteSandboxByName: async () => {
            throw new Error("Must not delete saved work");
          },
        }),
    });
    await runTest({ legacy, records, deps, providerNames });
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function collisionInput(rootDirectory: string | null = null) {
  return {
    ...identity,
    productTeamId: TEAM_ID,
    rootDirectory,
    name: buildSandboxName({
      ...identity,
      productTeamId: TEAM_ID,
      rootDirectory,
    }),
    credentials: { vercelToken: "vercel-token", vercelProjectId: "project-1" },
  };
}

test("team launch keeps an active legacy personal workspace", async () => {
  await withSavedWorkspaces(async ({ legacy, deps }) => {
    legacy.status = "running";
    const result = await deps.getActiveSandboxForRepo(
      REPO_ID,
      identity.userId,
      "main",
      null,
      TEAM_ID
    );
    assert.equal(result?.id, legacy.id);
    assert.equal(result?.sandbox_id, legacy.sandbox_id);
  });
});

test("team launch restarts the stopped legacy record instead of making a fresh checkout", async () => {
  await withSavedWorkspaces(async ({ legacy, deps, providerNames }) => {
    const result = await deps.resolveNameCollision(collisionInput());
    assert.equal(result.kind, "restart");
    if (result.kind === "restart") {
      assert.equal(result.record.id, legacy.id);
      assert.equal(result.record.sandbox_id, legacy.sandbox_id);
    }
    assert.deepEqual(
      providerNames,
      [],
      "the restart lifecycle owns the provider resume"
    );
  });
});

test("an existing team-scoped workspace takes precedence over the legacy namespace", async () => {
  await withSavedWorkspaces(
    async ({ legacy, records, deps, providerNames }) => {
      const input = collisionInput();
      records.unshift({
        ...legacy,
        id: "saved-team-workspace",
        product_team_id: TEAM_ID,
        sandbox_id: input.name,
      });
      const result = await deps.resolveNameCollision(input);
      assert.equal(result.kind, "restart");
      if (result.kind === "restart")
        assert.equal(result.record.id, "saved-team-workspace");
      assert.deepEqual(providerNames, [input.name]);
    }
  );
});

test("an active personal workspace does not displace a stopped team workspace", async () => {
  await withSavedWorkspaces(async ({ legacy, records, deps }) => {
    records.unshift({
      ...legacy,
      id: "saved-team-workspace",
      product_team_id: TEAM_ID,
      sandbox_id: collisionInput().name,
    });
    legacy.status = "running";
    const active = await deps.getActiveSandboxForRepo(
      REPO_ID,
      identity.userId,
      "main",
      null,
      TEAM_ID
    );
    assert.equal(active, null);
    const result = await deps.resolveNameCollision(collisionInput());
    assert.equal(result.kind, "restart");
    if (result.kind === "restart")
      assert.equal(result.record.id, "saved-team-workspace");
  });
});

test("legacy lookup does not cross root directories", async () => {
  await withSavedWorkspaces(async ({ legacy, deps, providerNames }) => {
    const input = collisionInput("apps/other");
    await assert.rejects(
      deps.resolveNameCollision(input),
      /Scoped provider probe failed/
    );
    assert.deepEqual(providerNames, [input.name]);
    assert.notEqual(input.name, legacy.sandbox_id);
  });
});

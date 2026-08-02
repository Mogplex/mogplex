import assert from "node:assert/strict";
import test from "node:test";

async function loadMemoryScopeValidation() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../lib/memory-scope-validation");
}

test("validateOwnedMemoryScope accepts owned repo and sandbox scope", async () => {
  const { validateOwnedMemoryScope } = await loadMemoryScopeValidation();

  const scope = await validateOwnedMemoryScope(
    "user-123",
    {
      repoId: "repo-123",
      sandboxId: "sandbox-123",
      workspaceSessionId: "ws-123",
      source: "native-chat",
    },
    {
      loadOwnedRepo: async () => ({ id: "repo-123" }),
      loadOwnedSandbox: async () => ({
        id: "sandbox-123",
        repo_id: "repo-123",
      }),
    }
  );

  assert.deepEqual(scope, {
    repoId: "repo-123",
    sandboxId: "sandbox-123",
    workspaceSessionId: "ws-123",
    source: "native-chat",
  });
});

test("validateOwnedMemoryScope rejects unknown repos", async () => {
  const { MemoryScopeValidationError, validateOwnedMemoryScope } =
    await loadMemoryScopeValidation();

  await assert.rejects(
    () =>
      validateOwnedMemoryScope(
        "user-123",
        { repoId: "repo-missing" },
        {
          loadOwnedRepo: async () => null,
          loadOwnedSandbox: async () => null,
        }
      ),
    (error: unknown) =>
      error instanceof MemoryScopeValidationError &&
      error.message === "Repo not found" &&
      error.status === 404
  );
});

test("validateOwnedMemoryScope validates repos against team resource scope", async () => {
  const { validateOwnedMemoryScope } = await loadMemoryScopeValidation();
  let scopedRepoLookup: Record<string, unknown> | null = null;

  const scope = await validateOwnedMemoryScope(
    "user-123",
    {
      repoId: "repo-team",
      resourceScope: "team",
      productTeamId: "team-123",
    },
    {
      loadOwnedRepo: async () => {
        throw new Error("loadOwnedRepo should not be called");
      },
      loadRepoForScope: async (repoId, productScope) => {
        scopedRepoLookup = { repoId, productScope };
        return { id: "repo-team" };
      },
      loadOwnedSandbox: async () => null,
    },
    {
      productScope: {
        kind: "team",
        userId: "user-123",
        productTeamId: "team-123",
      },
    }
  );

  assert.deepEqual(scopedRepoLookup, {
    repoId: "repo-team",
    productScope: {
      kind: "team",
      userId: "user-123",
      productTeamId: "team-123",
    },
  });
  assert.deepEqual(scope, {
    repoId: "repo-team",
    resourceScope: "team",
    productTeamId: "team-123",
  });
});

test("validateOwnedMemoryScope rejects unknown sandboxes", async () => {
  const { MemoryScopeValidationError, validateOwnedMemoryScope } =
    await loadMemoryScopeValidation();

  await assert.rejects(
    () =>
      validateOwnedMemoryScope(
        "user-123",
        { sandboxId: "sandbox-missing" },
        {
          loadOwnedRepo: async () => null,
          loadOwnedSandbox: async () => null,
        }
      ),
    (error: unknown) =>
      error instanceof MemoryScopeValidationError &&
      error.message === "Sandbox not found" &&
      error.status === 404
  );
});

test("validateOwnedMemoryScope rejects sandbox scope that conflicts with repo scope", async () => {
  const { MemoryScopeValidationError, validateOwnedMemoryScope } =
    await loadMemoryScopeValidation();

  await assert.rejects(
    () =>
      validateOwnedMemoryScope(
        "user-123",
        {
          repoId: "repo-123",
          sandboxId: "sandbox-123",
        },
        {
          loadOwnedRepo: async () => ({ id: "repo-123" }),
          loadOwnedSandbox: async () => ({
            id: "sandbox-123",
            repo_id: "repo-other",
          }),
        }
      ),
    (error: unknown) =>
      error instanceof MemoryScopeValidationError &&
      error.message === "Sandbox does not belong to repo" &&
      error.status === 400
  );
});

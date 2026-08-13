import assert from "node:assert/strict";
import test from "node:test";
import { validateControlSessionRepoAccess } from "../../lib/control/session-repo-access";

const REPO_ID = "00000000-0000-4000-8000-000000000001";

test("validateControlSessionRepoAccess rejects repos outside the active scope", async () => {
  const response = await validateControlSessionRepoAccess(
    {
      request: new Request("http://localhost/api/control/sessions"),
      userId: "user-1",
      repoId: REPO_ID,
    },
    {
      resolveProductResourceScope: async () => ({
        ok: true,
        scope: { kind: "personal", userId: "user-1", productTeamId: null },
      }),
      getRepoForScope: async () => null,
    }
  );

  assert.deepEqual(response, {
    ok: false,
    status: 404,
    error: "Repository not found",
  });
});

test("validateControlSessionRepoAccess accepts a repo in the active team scope", async () => {
  const teamScope = {
    kind: "team" as const,
    userId: "user-1",
    productTeamId: "team-1",
  };
  let receivedScope: typeof teamScope | null = null;
  const response = await validateControlSessionRepoAccess(
    {
      request: new Request("http://localhost/api/control/sessions"),
      userId: "user-1",
      repoId: REPO_ID,
    },
    {
      resolveProductResourceScope: async () => ({ ok: true, scope: teamScope }),
      getRepoForScope: async (_repoId, scope) => {
        receivedScope = scope as typeof teamScope;
        return { id: REPO_ID };
      },
    }
  );

  assert.deepEqual(receivedScope, teamScope);
  assert.deepEqual(response, { ok: true, value: REPO_ID });
});

test("validateControlSessionRepoAccess allows an explicitly unlinked session", async () => {
  const response = await validateControlSessionRepoAccess(
    {
      request: new Request("http://localhost/api/control/sessions"),
      userId: "user-1",
      repoId: null,
    },
    {
      resolveProductResourceScope: async () => {
        throw new Error("scope lookup should not run");
      },
      getRepoForScope: async () => {
        throw new Error("repo lookup should not run");
      },
    }
  );

  assert.deepEqual(response, { ok: true, value: null });
});

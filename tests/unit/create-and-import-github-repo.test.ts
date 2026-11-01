import assert from "node:assert/strict";
import test from "node:test";

process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";

async function createWithRefusal(
  status: number,
  kind: "personal" | "org",
  viaApp: boolean,
  forgotten: string[] = []
) {
  const { createAndImportGithubRepo } =
    await import("../../app/api/github/_lib/create-repo-with-recovery");
  const { GithubRepoCreateError } = await import("../../lib/github-create");
  const warn = console.warn;
  console.warn = () => {};
  try {
    return await createAndImportGithubRepo({
      deps: {
        createGithubRepo: async () => {
          throw new GithubRepoCreateError(
            status,
            '{"message":"Bad credentials"}'
          );
        },
        fetchGithubRepo: async () => {
          throw new Error("must not look up a conflict");
        },
        upsertGithubReposForUser: async () => {
          throw new Error("must not import a failed create");
        },
      },
      userId: "user-1",
      target: {
        ownerTarget: {
          login: "alex",
          kind,
          github_installation_id: 3,
          scope_label: kind === "personal" ? "Personal" : "Org",
          source: "installation",
        },
        token: "ghu_revoked",
        viaApp,
      },
      repo: { name: "widgets", visibility: "private" },
      importOptions: {},
      loadImported: async () => null,
      logScope: "test",
      forgetAppUserToken: async (userId, token) => {
        forgotten.push(`${userId}:${token}`);
      },
    });
  } finally {
    console.warn = warn;
  }
}

test("should ask to authorize again when GitHub rejects a personal App user token", async () => {
  const forgotten: string[] = [];
  const response = await createWithRefusal(401, "personal", true, forgotten);
  assert.deepEqual(forgotten, ["user-1:ghu_revoked"]);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    code: "GITHUB_APP_USER_AUTHORIZATION_REQUIRED",
    error: "Authorize Mogplex to create repositories in alex, then try again.",
    authorize_url: "/api/auth/github/app-user",
  });
});

test("should keep GitHub's refusal for a 401 outside the personal App path", async () => {
  const forgotten: string[] = [];
  const response = await createWithRefusal(401, "personal", false, forgotten);
  assert.deepEqual(forgotten, []);
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.code, undefined);
  assert.equal(body.error, "Bad credentials");
});

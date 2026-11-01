import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";

const originalFetch = globalThis.fetch;
const orderings: string[] = [];
afterEach(() => {
  globalThis.fetch = originalFetch;
});

async function loadWith(
  rows: Array<{ installation_id: number | string; account_login: string }>,
  user: Response
) {
  const { supabaseAdmin } = await import("../../lib/supabase/admin");
  const query = {
    select: () => query,
    eq: () => query,
    order: async (column: string, options: { ascending: boolean }) => {
      orderings.push(`${column}:${options.ascending ? "asc" : "desc"}`);
      return { data: rows, error: null };
    },
  };
  Object.defineProperty(supabaseAdmin, "from", {
    configurable: true,
    value: () => query,
  });
  globalThis.fetch = (async () => user) as typeof fetch;
  const { loadGithubAppCreateTarget } =
    await import("../../app/api/github/_lib/app-create-target");
  return loadGithubAppCreateTarget;
}

function userResponse() {
  return Response.json(
    { login: "Alex" },
    { headers: { "x-oauth-scopes": "read:org, read:user" } }
  );
}

test("an App create target attaches the user's installation for the named org", async () => {
  const load = await loadWith(
    [{ installation_id: "42", account_login: "Acme" }],
    userResponse()
  );
  const { target, oauthScopes } = await load("user-1", "identity", "acme");
  assert.equal(target?.kind, "org");
  assert.equal(target?.github_installation_id, 42);
  assert.deepEqual(oauthScopes, ["read:org", "read:user"]);
  // After a reinstall the newest installation row must win.
  assert.deepEqual(orderings.at(-1), "created_at:desc");
});

test("an App create target without an owner is the user's personal account", async () => {
  const load = await loadWith([], userResponse());
  const { target } = await load("user-1", "identity", null);
  assert.equal(target?.login, "Alex");
  assert.equal(target?.kind, "personal");
  assert.equal(target?.github_installation_id, null);
});

test("an App create target leaves an org without the user's installation unattached", async () => {
  const load = await loadWith(
    [{ installation_id: 7, account_login: "other" }],
    userResponse()
  );
  const { target } = await load("user-1", "identity", "acme");
  assert.equal(target?.kind, "org");
  assert.equal(target?.github_installation_id, null);
});

test("an App create target propagates a GitHub failure instead of denying", async () => {
  const load = await loadWith([], new Response("unavailable", { status: 503 }));
  await assert.rejects(load("user-1", "identity", "acme"), /503/);
});

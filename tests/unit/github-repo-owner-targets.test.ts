import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";

const originalFetch = globalThis.fetch;
let restoreFrom: (() => void) | null = null;
afterEach(() => {
  globalThis.fetch = originalFetch;
  restoreFrom?.();
  restoreFrom = null;
});

async function loadWithGithub(requests: string[]) {
  const { supabaseAdmin } = await import("../../lib/supabase/admin");
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({
      data: { github_username: "alex" },
      error: null,
    }),
    order: async () => ({ data: [], error: null }),
  };
  const original = Object.getOwnPropertyDescriptor(supabaseAdmin, "from");
  restoreFrom = () => {
    if (original) Object.defineProperty(supabaseAdmin, "from", original);
    else delete (supabaseAdmin as { from?: unknown }).from;
  };
  Object.defineProperty(supabaseAdmin, "from", {
    configurable: true,
    value: () => query,
  });
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    requests.push(new URL(url).pathname);
    if (url.endsWith("/user")) {
      return Response.json(
        { login: "Alex" },
        { headers: { "x-oauth-scopes": "repo, read:org" } }
      );
    }
    return new Response("rate limited", { status: 403 });
  }) as typeof fetch;
  const { loadGithubRepoCreationOwnerTargets } =
    await import("../../app/api/github/_lib/repo-owner-targets");
  return loadGithubRepoCreationOwnerTargets;
}

test("should resolve the personal account without probing it as an organization", async () => {
  const requests: string[] = [];
  const load = await loadWithGithub(requests);
  const { targets } = await load("user-1", "token", { onlyLogin: "alex" });
  assert.deepEqual(
    targets.map((target) => [target.login, target.kind]),
    [["Alex", "personal"]]
  );
  assert.deepEqual(requests, ["/user"]);
});

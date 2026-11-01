import assert from "node:assert/strict";
import test from "node:test";

process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";

const targets = [
  {
    login: "alex",
    kind: "personal" as const,
    github_installation_id: null,
    scope_label: "Personal",
    source: "oauth" as const,
  },
  {
    login: "acme",
    kind: "org" as const,
    github_installation_id: 7,
    scope_label: "Org",
    source: "installation" as const,
  },
];

async function load() {
  return import("../../app/api/github/_lib/personal-authorization");
}

test("should leave targets alone when no GitHub App is configured", async () => {
  const { markPersonalAuthorization } = await load();
  const result = await markPersonalAuthorization("user-1", targets, {
    appConfigured: () => false,
  });
  assert.deepEqual(result, targets);
});

test("should hide the personal account when the App has no client credentials", async () => {
  const { markPersonalAuthorization } = await load();
  const result = await markPersonalAuthorization("user-1", targets, {
    appConfigured: () => true,
    appUserAuthConfigured: () => false,
  });
  assert.deepEqual(
    result.map((target) => target.login),
    ["acme"]
  );
});

test("should mark the personal account until the user authorizes the App", async () => {
  const { markPersonalAuthorization } = await load();
  const withGrant = (granted: boolean) =>
    markPersonalAuthorization("user-1", targets, {
      appConfigured: () => true,
      appUserAuthConfigured: () => true,
      hasGrant: async () => granted,
    });
  assert.equal((await withGrant(false))[0]?.authorization_required, true);
  assert.equal((await withGrant(true))[0]?.authorization_required, false);
  assert.equal((await withGrant(false))[1]?.authorization_required, undefined);
});

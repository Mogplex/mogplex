import assert from "node:assert/strict";
import test from "node:test";

async function loadSlackLinkPage() {
  // These imports are intentionally module-cached; keep env defaults stable here.
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/slack/link/page");
}

test("Slack link tokens are constrained to base64url characters", async () => {
  const { isValidSlackLinkToken } = await loadSlackLinkPage();
  const validToken = "A".repeat(43);

  assert.equal(isValidSlackLinkToken(validToken), true);
  assert.equal(isValidSlackLinkToken("A"), false);
  assert.equal(isValidSlackLinkToken("A".repeat(42)), false);
  assert.equal(isValidSlackLinkToken("A".repeat(44)), false);
  assert.equal(isValidSlackLinkToken(""), false);
  assert.equal(isValidSlackLinkToken("../settings"), false);
  assert.equal(isValidSlackLinkToken("https://example.com"), false);
  assert.equal(isValidSlackLinkToken("abc%2Fdef"), false);
  assert.equal(isValidSlackLinkToken(` ${validToken}`), false);
  assert.equal(isValidSlackLinkToken(`${validToken} `), false);
});

test("Slack login redirect keeps the validated token inside a same-origin next path", async () => {
  const { buildLoginRedirect } = await loadSlackLinkPage();
  const validToken = "A".repeat(43);

  const redirectPath = buildLoginRedirect(validToken);
  const url = new URL(`https://mogplex.test${redirectPath}`);

  assert.equal(url.pathname, "/login");
  assert.equal(url.searchParams.get("next"), `/slack/link?token=${validToken}`);
});

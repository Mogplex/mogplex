import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSlackAuthorizeUrl,
  exchangeSlackCode,
  SLACK_AUTHORIZE_URL,
  SLACK_BOT_SCOPES,
  SLACK_OAUTH_STATE_TTL_SECONDS,
  signSlackOAuthState,
  verifySlackOAuthState,
} from "../../lib/slack/oauth";

const SIGNING_SECRET = ["test", "slack", "signing", "secret"].join("-");

function makeState(
  overrides: Partial<{ userId: string; nonce: string; ts: number }> = {}
) {
  return {
    userId: "user-1",
    nonce: "nonce-abc",
    ts: 1_700_000_000,
    ...overrides,
  };
}

test("signSlackOAuthState produces a state that round-trips through verify", () => {
  const payload = makeState();
  const token = signSlackOAuthState(payload, SIGNING_SECRET);

  const result = verifySlackOAuthState(
    token,
    SIGNING_SECRET,
    () => payload.ts * 1000
  );
  assert.deepEqual(result, payload);
});

test("verifySlackOAuthState rejects a tampered payload", () => {
  const token = signSlackOAuthState(makeState(), SIGNING_SECRET);
  const [body, mac] = token.split(".");
  const reSigned = `${body}A.${mac}`; // mutate body, keep mac

  const result = verifySlackOAuthState(
    reSigned,
    SIGNING_SECRET,
    () => 1_700_000_000 * 1000
  );
  assert.equal(result, null);
});

test("verifySlackOAuthState rejects a wrong signing secret", () => {
  const token = signSlackOAuthState(makeState(), SIGNING_SECRET);

  const result = verifySlackOAuthState(
    token,
    "different-secret",
    () => 1_700_000_000 * 1000
  );
  assert.equal(result, null);
});

test("verifySlackOAuthState rejects an expired state", () => {
  const payload = makeState();
  const token = signSlackOAuthState(payload, SIGNING_SECRET);

  const result = verifySlackOAuthState(
    token,
    SIGNING_SECRET,
    () => (payload.ts + SLACK_OAUTH_STATE_TTL_SECONDS + 1) * 1000
  );
  assert.equal(result, null);
});

test("verifySlackOAuthState rejects a state from the future beyond clock-skew tolerance", () => {
  const payload = makeState({ ts: 1_700_000_300 });
  const token = signSlackOAuthState(payload, SIGNING_SECRET);

  // Caller's clock thinks it's well before the token's ts.
  const result = verifySlackOAuthState(
    token,
    SIGNING_SECRET,
    () => (payload.ts - 120) * 1000
  );
  assert.equal(result, null);
});

test("verifySlackOAuthState returns null for malformed inputs without throwing", () => {
  assert.equal(verifySlackOAuthState("", SIGNING_SECRET), null);
  assert.equal(verifySlackOAuthState("no-dot-here", SIGNING_SECRET), null);
  assert.equal(verifySlackOAuthState(".no-body", SIGNING_SECRET), null);
  assert.equal(verifySlackOAuthState("no-mac.", SIGNING_SECRET), null);
});

test("buildSlackAuthorizeUrl includes client id, scopes, redirect uri, and state", () => {
  const url = buildSlackAuthorizeUrl({
    clientId: "1234.5678",
    redirectUri: "https://example.test/api/integrations/slack/callback",
    state: "the-state-token",
  });

  assert.ok(url.startsWith(SLACK_AUTHORIZE_URL));
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get("client_id"), "1234.5678");
  assert.equal(
    parsed.searchParams.get("redirect_uri"),
    "https://example.test/api/integrations/slack/callback"
  );
  assert.equal(parsed.searchParams.get("state"), "the-state-token");
  assert.equal(parsed.searchParams.get("scope"), SLACK_BOT_SCOPES.join(","));
});

test("Slack OAuth requests access to download message attachments", () => {
  assert.ok(new Set<string>(SLACK_BOT_SCOPES).has("files:read"));
});

test("exchangeSlackCode returns a structured failure for non-2xx Slack responses", async () => {
  const result = await exchangeSlackCode(
    {
      code: "oauth-code",
      config: {
        clientId: "client-1",
        clientSecret: "secret-1",
        signingSecret: SIGNING_SECRET,
        redirectUri: "https://example.test/api/integrations/slack/callback",
      },
    },
    {
      fetchImpl: async () =>
        new Response("<html>oops</html>", {
          status: 500,
          headers: { "content-type": "text/html" },
        }),
    }
  );

  assert.deepEqual(result, { ok: false, error: "http_500" });
});

test("exchangeSlackCode returns a structured failure for invalid Slack JSON", async () => {
  const result = await exchangeSlackCode(
    {
      code: "oauth-code",
      config: {
        clientId: "client-1",
        clientSecret: "secret-1",
        signingSecret: SIGNING_SECRET,
        redirectUri: "https://example.test/api/integrations/slack/callback",
      },
    },
    {
      fetchImpl: async () =>
        new Response("not-json", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    }
  );

  assert.deepEqual(result, { ok: false, error: "invalid_response" });
});

test("OAuth callback clears the state cookie at the root path", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  const { deleteSlackOAuthStateCookie } =
    await import("../../app/api/integrations/slack/callback/route");

  let deleted: { name: string; path: string } | null = null;
  deleteSlackOAuthStateCookie({
    delete: (options) => {
      deleted = options;
    },
  });

  assert.deepEqual(deleted, {
    name: "slack_oauth_state",
    path: "/",
  });
});

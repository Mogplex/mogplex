import assert from "node:assert/strict";
import test from "node:test";
import {
  signSlackOAuthState,
  type SlackOAuthAccessResponse,
  type SlackOAuthConfig,
  type SlackOAuthStatePayload,
} from "../../lib/slack/oauth";

// Deterministic, clearly-synthetic secret — never a real Slack signing secret.
const SIGNING_SECRET = ["test", "slack", "signing", "secret"].join("-");

async function loadCallbackRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/integrations/slack/callback/route");
}

const NONCE = "nonce-xyz";
const USER_ID = "user-123";

function statePayload(
  overrides: Partial<SlackOAuthStatePayload> = {}
): SlackOAuthStatePayload {
  return {
    userId: USER_ID,
    nonce: NONCE,
    ts: Math.floor(Date.now() / 1000),
    ...overrides,
  };
}

function signedState(overrides: Partial<SlackOAuthStatePayload> = {}) {
  return signSlackOAuthState(statePayload(overrides), SIGNING_SECRET);
}

const OAUTH_CONFIG: SlackOAuthConfig = {
  clientId: "client-1",
  clientSecret: "secret-1",
  signingSecret: SIGNING_SECRET,
  redirectUri: "https://example.test/api/integrations/slack/callback",
};

function makeCookieStore(nonce: string | null) {
  const deleted: Array<{ name: string; path: string }> = [];
  return {
    deleted,
    store: {
      get: (name: string) =>
        nonce !== null && name === "slack_oauth_state"
          ? { value: nonce }
          : undefined,
      delete: (options: { name: string; path: string }) => {
        deleted.push(options);
      },
    },
  };
}

function callbackRequest(params: Record<string, string>) {
  const url = new URL("http://localhost/api/integrations/slack/callback");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return new Request(url);
}

function locationParams(response: Response) {
  const location = response.headers.get("location");
  assert.ok(location, "expected a Location header");
  return new URL(location).searchParams;
}

const successExchange: SlackOAuthAccessResponse = {
  ok: true,
  access_token: "xoxb-token",
  bot_user_id: "B123",
  scope: "chat:write,channels:history",
  team: { id: "T123", name: "Acme" },
  authed_user: { id: "U456" },
};

function baseDeps(cookieNonce: string | null = NONCE) {
  return {
    getCookieStore: async () => makeCookieStore(cookieNonce).store,
    getOAuthConfig: () => OAUTH_CONFIG,
    exchangeCode: async () => successExchange,
    upsertInstallation: async () => undefined,
  };
}

test("valid callback exchanges the code and redirects with slack=connected", async () => {
  const { createSlackCallbackGetHandler } = await loadCallbackRoute();

  const cookies = makeCookieStore(NONCE);
  let upserted: unknown = null;
  const handler = createSlackCallbackGetHandler({
    ...baseDeps(),
    getCookieStore: async () => cookies.store,
    upsertInstallation: async (input) => {
      upserted = input;
    },
  });

  const response = await handler(
    callbackRequest({ code: "the-code", state: signedState() })
  );
  const params = locationParams(response);

  assert.equal(params.get("slack"), "connected");
  assert.equal(params.get("team"), "T123");
  assert.deepEqual(upserted, {
    teamId: "T123",
    teamName: "Acme",
    installedByUserId: USER_ID,
    botUserId: "B123",
    botToken: "xoxb-token",
    scopes: ["chat:write", "channels:history"],
    authedUserSlackId: "U456",
  });
  // Single-use state cookie is always cleared.
  assert.deepEqual(cookies.deleted, [{ name: "slack_oauth_state", path: "/" }]);
});

test("invalid signed state redirects with slack=error&reason=invalid_state", async () => {
  const { createSlackCallbackGetHandler } = await loadCallbackRoute();

  let exchanged = false;
  const handler = createSlackCallbackGetHandler({
    ...baseDeps(),
    exchangeCode: async () => {
      exchanged = true;
      return successExchange;
    },
  });

  const response = await handler(
    callbackRequest({ code: "the-code", state: "not-a-valid-state" })
  );
  const params = locationParams(response);

  assert.equal(params.get("slack"), "error");
  assert.equal(params.get("reason"), "invalid_state");
  assert.equal(exchanged, false);
});

test("cookie nonce mismatch redirects with slack=error&reason=nonce_mismatch", async () => {
  const { createSlackCallbackGetHandler } = await loadCallbackRoute();

  const handler = createSlackCallbackGetHandler(baseDeps("a-different-nonce"));

  const response = await handler(
    callbackRequest({ code: "the-code", state: signedState() })
  );
  const params = locationParams(response);

  assert.equal(params.get("slack"), "error");
  assert.equal(params.get("reason"), "nonce_mismatch");
});

test("missing nonce cookie redirects with slack=error&reason=nonce_mismatch", async () => {
  const { createSlackCallbackGetHandler } = await loadCallbackRoute();

  const handler = createSlackCallbackGetHandler(baseDeps(null));

  const response = await handler(
    callbackRequest({ code: "the-code", state: signedState() })
  );
  const params = locationParams(response);

  assert.equal(params.get("slack"), "error");
  assert.equal(params.get("reason"), "nonce_mismatch");
});

test("failed oauth.v2.access redirects with the Slack error reason", async () => {
  const { createSlackCallbackGetHandler } = await loadCallbackRoute();

  const handler = createSlackCallbackGetHandler({
    ...baseDeps(),
    exchangeCode: async () => ({ ok: false, error: "invalid_code" }),
    upsertInstallation: async () => {
      throw new Error("should not be called");
    },
  });

  const response = await handler(
    callbackRequest({ code: "the-code", state: signedState() })
  );
  const params = locationParams(response);

  assert.equal(params.get("slack"), "error");
  assert.equal(params.get("reason"), "invalid_code");
});

test("upsertSlackInstallation throwing redirects with slack=error&reason=persist_failed", async () => {
  const { createSlackCallbackGetHandler } = await loadCallbackRoute();

  const handler = createSlackCallbackGetHandler({
    ...baseDeps(),
    upsertInstallation: async () => {
      throw new Error("vault write failed");
    },
  });

  const response = await handler(
    callbackRequest({ code: "the-code", state: signedState() })
  );
  const params = locationParams(response);

  assert.equal(params.get("slack"), "error");
  assert.equal(params.get("reason"), "persist_failed");
});

test("user-denied callback redirects with slack=denied", async () => {
  const { createSlackCallbackGetHandler } = await loadCallbackRoute();

  const handler = createSlackCallbackGetHandler(baseDeps());

  const response = await handler(callbackRequest({ error: "access_denied" }));
  const params = locationParams(response);

  assert.equal(params.get("slack"), "denied");
  assert.equal(params.get("reason"), "access_denied");
});

test("missing code/state redirects with slack=error&reason=missing_params", async () => {
  const { createSlackCallbackGetHandler } = await loadCallbackRoute();

  const handler = createSlackCallbackGetHandler(baseDeps());

  const response = await handler(callbackRequest({ state: "only-state" }));
  const params = locationParams(response);

  assert.equal(params.get("slack"), "error");
  assert.equal(params.get("reason"), "missing_params");
});

test("missing OAuth config redirects with slack=not_configured", async () => {
  const { createSlackCallbackGetHandler } = await loadCallbackRoute();

  const handler = createSlackCallbackGetHandler({
    ...baseDeps(),
    getOAuthConfig: () => null,
  });

  const response = await handler(
    callbackRequest({ code: "the-code", state: signedState() })
  );
  const params = locationParams(response);

  assert.equal(params.get("slack"), "not_configured");
});

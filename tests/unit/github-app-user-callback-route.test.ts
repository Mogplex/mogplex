import assert from "node:assert/strict";
import test from "node:test";

process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";

const STATE = "state-123";

function cookieStore(state: string | null, returnTo = "/personal/control") {
  const values = new Map<string, string>();
  if (state) values.set("github_app_user_state", state);
  values.set("github_app_user_return_to", returnTo);
  const deleted: string[] = [];
  return {
    deleted,
    store: {
      get: (name: string) => {
        const value = values.get(name);
        return value === undefined ? undefined : { value };
      },
      delete: (name: string) => deleted.push(name),
    },
  };
}

const tokens = {
  accessToken: "ghu_user",
  accessTokenExpiresAt: 1,
  refreshToken: "ghr_refresh",
  refreshTokenExpiresAt: 2,
};

async function handlerWith(
  overrides: Record<string, unknown>,
  cookieState: string | null = STATE
) {
  const { createGithubAppUserCallbackHandler } =
    await import("../../app/api/auth/github/app-user/callback/route");
  const cookies = cookieStore(cookieState);
  const stored: unknown[] = [];
  const handler = createGithubAppUserCallbackHandler({
    getCookieStore: async () => cookies.store,
    getUserId: async () => "user-1",
    exchangeCode: async () => tokens,
    getIdentityToken: async () => "identity",
    fetchLogin: async (token: string) =>
      token === "identity" ? "Alex" : "alex",
    storeGrant: async (_userId, grant) => {
      stored.push(grant);
    },
    ...overrides,
  });
  return { handler, stored, cookies };
}

function callbackRequest(state = STATE) {
  return new Request(
    `https://mogplex.com/api/auth/github/app-user/callback?code=abc&state=${state}`
  );
}

function outcome(response: Response) {
  const location = new URL(response.headers.get("location") ?? "");
  return {
    path: location.pathname,
    result: location.searchParams.get("github_app_user"),
  };
}

test("stores the App grant for the connected GitHub account and returns the user", async () => {
  const { handler, stored, cookies } = await handlerWith({});
  const response = await handler(callbackRequest());
  assert.deepEqual(outcome(response), {
    path: "/personal/control",
    result: "authorized",
  });
  assert.deepEqual(stored, [{ ...tokens, login: "alex" }]);
  assert.deepEqual(cookies.deleted.sort(), [
    "github_app_user_return_to",
    "github_app_user_state",
  ]);
});

test("refuses a grant for a different GitHub account than the one connected", async () => {
  const { handler, stored } = await handlerWith({
    fetchLogin: async (token: string) =>
      token === "identity" ? "alex" : "someone-else",
  });
  const response = await handler(callbackRequest());
  assert.equal(outcome(response).result, "account_mismatch");
  assert.deepEqual(stored, []);
});

test("refuses a callback whose state does not match the cookie", async () => {
  let exchanged = false;
  const { handler, stored } = await handlerWith({
    exchangeCode: async () => {
      exchanged = true;
      return tokens;
    },
  });
  const response = await handler(callbackRequest("forged"));
  assert.equal(outcome(response).result, "state_mismatch");
  assert.equal(exchanged, false);
  assert.deepEqual(stored, []);
});

test("refuses a callback with no state cookie", async () => {
  const { handler, stored } = await handlerWith({}, null);
  const response = await handler(callbackRequest());
  assert.equal(outcome(response).result, "state_mismatch");
  assert.deepEqual(stored, []);
});

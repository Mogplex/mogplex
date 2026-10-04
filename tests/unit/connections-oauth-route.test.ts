import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createConnectionOAuthGetHandler } from "../../app/api/connections/oauth/route";
import { generatePkceChallenge } from "../../lib/connections/oauth";
import type { Connection } from "../../lib/types";

const id = "00000000-0000-4000-8000-000000000001";
const request = (value: string | null = id) =>
  new Request(
    `https://app.example.com/api/connections/oauth${value === null ? "" : `?connectionId=${encodeURIComponent(value)}`}`
  );
const row: Connection = {
  id,
  user_id: "user-1",
  name: "Example",
  type: "rest_api",
  base_url: "https://api.example.com",
  auth_type: "oauth",
  auth_header: null,
  mcp_transport: null,
  mcp_url: null,
  description: null,
  is_enabled: true,
  approval_mode: "auto",
  health_status: "unknown",
  scope: "global",
  repo_id: null,
  oauth_client_id: "synthetic-client",
  oauth_authorize_url: "https://provider.example.com/authorize",
  oauth_token_url: "https://provider.example.com/token",
  oauth_scopes: "read write",
  oauth_authorized_at: null,
  oauth_token_expires_at: null,
  source_preset: null,
  last_tested_at: null,
  last_test_error: null,
  last_test_http_status: null,
  last_test_tool_count: null,
  created_at: "2026-01-01",
  updated_at: "2026-02-01",
};
function fixture(
  options: {
    connection?: Partial<Connection>;
    missing?: boolean;
    failRead?: boolean;
  } = {}
) {
  const reads: string[] = [];
  const set: {
    name: string;
    value: string;
    options: {
      httpOnly: boolean;
      sameSite: "lax";
      maxAge: number;
      path: string;
      secure: boolean;
    };
  }[] = [];
  const deleted: string[] = [];
  const db = createClient("https://database.example", "unit-test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input) => {
        const url = new URL(String(input));
        assert.equal(url.pathname, "/rest/v1/connections");
        assert.equal(url.searchParams.get("user_id"), "eq.user-1");
        reads.push(url.search);
        return options.failRead
          ? Response.json(
              { message: "Read failed", code: "XX000" },
              { status: 500 }
            )
          : Response.json(
              options.missing ? null : { ...row, ...options.connection }
            );
      },
    },
  });
  const deps = {
    requireUserId: async () => "user-1",
    db,
    getCookies: async () => ({
      set: (
        name: string,
        value: string,
        options: (typeof set)[number]["options"]
      ) => {
        set.push({ name, value, options });
      },
      delete: (name: string) => {
        deleted.push(name);
      },
    }),
  };
  return {
    deps,
    handler: createConnectionOAuthGetHandler(deps),
    reads,
    set,
    deleted,
  };
}

for (const preset of [false, true]) {
  test(`OAuth GET builds a scoped redirect, CSRF state and PKCE (${preset})`, async () => {
    const f = fixture({
      connection: preset
        ? {
            source_preset: "notion",
            type: "mcp_server",
            mcp_url: "https://mcp.notion.com/mcp",
            mcp_transport: "http",
            oauth_scopes: null,
          }
        : {},
    });
    const response = await f.handler(request());
    assert.equal(response.status, 307);
    const url = new URL(response.headers.get("location")!);
    assert.equal(url.origin, "https://provider.example.com");
    assert.equal(url.searchParams.get("client_id"), "synthetic-client");
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.ok(
      url.searchParams
        .get("redirect_uri")
        ?.endsWith("/api/connections/oauth/callback")
    );
    const state = f.set.find((cookie) => cookie.name === "conn_oauth_state")!;
    const decoded = JSON.parse(atob(state.value));
    assert.equal(decoded.connectionId, id);
    assert.equal(decoded.userId, "user-1");
    assert.match(decoded.nonce, /^[0-9a-f-]{36}$/);
    assert.equal(url.searchParams.get("state"), state.value);
    assert.deepEqual(state.options, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 600,
      path: "/",
      secure: process.env.NODE_ENV === "production",
    });
    assert.ok(f.reads[0]?.includes(`id=eq.${id}`));
    if (preset) {
      const verifier = f.set.find(
        (cookie) => cookie.name === "conn_oauth_pkce_verifier"
      )!;
      assert.ok(verifier.value.length >= 43);
      assert.equal(
        url.searchParams.get("code_challenge"),
        generatePkceChallenge(verifier.value)
      );
      assert.equal(url.searchParams.get("code_challenge_method"), "S256");
      assert.equal(url.searchParams.get("prompt"), "consent");
      assert.deepEqual(f.deleted, []);
    } else {
      assert.equal(url.searchParams.get("scope"), "read write");
      assert.deepEqual(f.deleted, ["conn_oauth_pkce_verifier"]);
    }
  });
}

for (const value of [
  null,
  "",
  "bad-id",
  "1",
  "00000000-0000-4000-8000-00000000000",
]) {
  test(`OAuth GET rejects invalid connection query ${value} with flattened errors before ownership reads`, async () => {
    const f = fixture();
    const response = await f.handler(request(value));
    assert.equal(response.status, 400);
    const result = await response.json();
    assert.equal(result.error, "Invalid connection ID.");
    assert.ok(result.details.fieldErrors.connectionId.length > 0);
    assert.deepEqual(f.reads, []);
    assert.deepEqual(f.set, []);
    assert.deepEqual(f.deleted, []);
  });
}

test("OAuth GET signs in before validating query", async () => {
  const f = fixture();
  const handler = createConnectionOAuthGetHandler({
    ...f.deps,
    requireUserId: async () =>
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
  });
  assert.equal((await handler(request("bad"))).status, 401);
  assert.deepEqual(f.reads, []);
  assert.deepEqual(f.set, []);
});

for (const options of [{ missing: true }, { failRead: true }]) {
  test(`OAuth GET preserves unavailable owned connection 404 (${JSON.stringify(options)})`, async () => {
    const f = fixture(options);
    assert.equal((await f.handler(request())).status, 404);
    assert.deepEqual(f.set, []);
  });
}

for (const connection of [
  { auth_type: "none" as const },
  { oauth_client_id: null },
  { oauth_authorize_url: null },
]) {
  test(`OAuth GET rejects incomplete configuration ${JSON.stringify(connection)}`, async () => {
    const f = fixture({ connection });
    const response = await f.handler(request());
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "Connection is not configured for OAuth",
    });
    assert.deepEqual(f.set, []);
  });
}

test("OAuth GET retains setup-error redirect on malformed stored authorize URL", async () => {
  const f = fixture({ connection: { oauth_authorize_url: "invalid-url" } });
  const response = await f.handler(request());
  assert.equal(response.status, 307);
  assert.equal(
    new URL(response.headers.get("location")!).searchParams.get("oauth"),
    "setup_error"
  );
});

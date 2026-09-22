import assert from "node:assert/strict";
import test from "node:test";
import {
  ConnectionValidationError,
  isConnectionMisconfigured,
  normalizeConnectionCreateInput,
} from "../../lib/connections/validation";

test("Neon quick-add pins hosted HTTP and bearer auth to the verified preset", () => {
  const input = normalizeConnectionCreateInput({
    source_preset: "neon",
    credentials: "  neon_test_key  ",
    mcp_url: "https://attacker.example.com",
    auth_type: "none",
  });

  assert.equal(input.name, "Neon");
  assert.equal(input.type, "mcp_server");
  assert.equal(input.mcp_url, "https://mcp.neon.tech/mcp");
  assert.equal(input.mcp_transport, "http");
  assert.equal(input.auth_type, "bearer");
  assert.equal(input.auth_header, "Authorization");
  assert.equal(input.credentials, "neon_test_key");
  assert.equal(input.source_preset, "neon");
});

test("Neon quick-add requires an API key", () => {
  assert.throws(
    () => normalizeConnectionCreateInput({ source_preset: "neon" }),
    /Neon requires a credential/
  );
});

test("preset-backed connections are normalized from server-side preset metadata", () => {
  const input = normalizeConnectionCreateInput({
    name: "Custom Browserbase",
    type: "mcp_server",
    source_preset: "browserbase",
    mcp_url: "https://attacker.example.com",
    auth_type: "bearer",
    credentials: "bb_live_123",
    description: "Custom description",
  });

  assert.equal(input.name, "Browserbase");
  assert.equal(input.type, "mcp_server");
  assert.equal(input.mcp_url, "https://mcp.browserbase.com/mcp");
  assert.equal(input.auth_type, "api_key");
  assert.equal(input.source_preset, "browserbase");
});

test("oauth presets normalize without requiring an inline credential", () => {
  const input = normalizeConnectionCreateInput({
    source_preset: "notion",
    credentials: "",
  });

  assert.equal(input.name, "Notion");
  assert.equal(input.type, "mcp_server");
  assert.equal(input.auth_type, "oauth");
  assert.equal(input.mcp_url, "https://mcp.notion.com/mcp");
  assert.equal(input.credentials, undefined);
  assert.equal(input.source_preset, "notion");
});

test("native OAuth presets normalize without inline credentials or OAuth client fields", () => {
  const input = normalizeConnectionCreateInput({
    source_preset: "sentry",
    credentials: "",
  });

  assert.equal(input.name, "Sentry");
  assert.equal(input.type, "mcp_server");
  assert.equal(input.auth_type, "oauth");
  assert.equal(input.mcp_url, "https://mcp.sentry.dev/mcp");
  assert.equal(input.credentials, undefined);
  assert.equal(input.oauth_client_id, undefined);
  assert.equal(input.oauth_authorize_url, undefined);
  assert.equal(input.oauth_token_url, undefined);
  assert.equal(input.source_preset, "sentry");
});

test("zapier preset preserves the user-specific MCP URL", () => {
  const input = normalizeConnectionCreateInput({
    source_preset: "zapier",
    mcp_url: "https://mcp.zapier.com/custom/server-secret",
  });

  assert.equal(input.name, "Zapier");
  assert.equal(input.auth_type, "none");
  assert.equal(input.mcp_url, "https://mcp.zapier.com/custom/server-secret");
  assert.equal(input.source_preset, "zapier");
});

test("manual oauth connections normalize raw client secrets into JSON credentials", () => {
  const input = normalizeConnectionCreateInput({
    name: "Linear OAuth",
    type: "mcp_server",
    mcp_url: "https://mcp.linear.app/mcp",
    mcp_transport: "http",
    auth_type: "oauth",
    oauth_client_id: "client_123",
    oauth_authorize_url: "https://linear.app/oauth/authorize",
    oauth_token_url: "https://api.linear.app/oauth/token",
    credentials: "super-secret",
  });

  assert.equal(input.auth_type, "oauth");
  assert.equal(
    input.credentials,
    JSON.stringify({ client_secret: "super-secret" })
  );
});

test("project-scoped connections require a repo id", () => {
  assert.throws(
    () =>
      normalizeConnectionCreateInput({
        name: "Repo MCP",
        type: "mcp_server",
        mcp_url: "https://example.com/mcp",
        mcp_transport: "http",
        auth_type: "none",
        scope: "project",
      }),
    (error: unknown) =>
      error instanceof ConnectionValidationError &&
      error.message === "repo_id is required for project-scoped connections"
  );
});

test("rest_api connections reject localhost targets", () => {
  assert.throws(
    () =>
      normalizeConnectionCreateInput({
        name: "Local API",
        type: "rest_api",
        base_url: "http://localhost:3000",
        auth_type: "none",
      }),
    (error: unknown) =>
      error instanceof ConnectionValidationError &&
      error.message === "base_url must target a public host"
  );
});

test("mcp_server connections reject private network targets", () => {
  assert.throws(
    () =>
      normalizeConnectionCreateInput({
        name: "Internal MCP",
        type: "mcp_server",
        mcp_url: "https://192.168.1.10/mcp",
        mcp_transport: "http",
        auth_type: "none",
      }),
    (error: unknown) =>
      error instanceof ConnectionValidationError &&
      error.message === "mcp_url must target a public host"
  );
});

test("dynamic OAuth presets are not treated as misconfigured before discovery", () => {
  assert.equal(
    isConnectionMisconfigured({
      type: "mcp_server",
      auth_type: "oauth",
      base_url: null,
      mcp_url: "https://mcp.sentry.dev/mcp",
      mcp_transport: "http",
      oauth_client_id: null,
      oauth_authorized_at: null,
      oauth_authorize_url: null,
      oauth_token_url: null,
      source_preset: "sentry",
    }),
    false
  );
});

test("broker-era OAuth preset rows stay out of runtime until native reconnect", () => {
  assert.equal(
    isConnectionMisconfigured({
      type: "mcp_server",
      auth_type: "bearer",
      base_url: null,
      mcp_url: "https://mcp.sentry.dev/mcp",
      mcp_transport: "http",
      oauth_client_id: null,
      oauth_authorized_at: null,
      oauth_authorize_url: null,
      oauth_token_url: null,
      source_preset: "sentry",
    }),
    true
  );
});

test("authorized broker-era OAuth rows stay out of runtime until native reconnect", () => {
  assert.equal(
    isConnectionMisconfigured({
      type: "mcp_server",
      auth_type: "oauth",
      base_url: null,
      mcp_url: "https://mcp.sentry.dev/mcp",
      mcp_transport: "http",
      oauth_client_id: null,
      oauth_authorized_at: "2026-03-18T00:00:00.000Z",
      oauth_authorize_url: null,
      oauth_token_url: null,
      source_preset: "sentry",
    }),
    true
  );
});

test("should normalize the Trigger.dev preset to a stdio row with no URL when a client sends one", () => {
  const input = normalizeConnectionCreateInput({
    source_preset: "trigger",
    mcp_url: "https://attacker.example.com/mcp",
    mcp_transport: "http",
    credentials: "tr_pat_123",
  });

  assert.equal(input.name, "Trigger.dev");
  assert.equal(input.mcp_transport, "stdio");
  assert.equal(input.mcp_url, undefined);
  assert.equal(input.auth_type, "bearer");
  assert.equal(input.credentials, "tr_pat_123");
});

test("should reject the Trigger.dev preset when the token is missing", () => {
  assert.throws(
    () => normalizeConnectionCreateInput({ source_preset: "trigger" }),
    (error: unknown) =>
      error instanceof ConnectionValidationError &&
      error.message.includes("requires a credential")
  );
});

test("should never accept stdio as a manual transport", () => {
  const input = normalizeConnectionCreateInput({
    name: "Manual",
    type: "mcp_server",
    mcp_url: "https://mcp.example.com/mcp",
    mcp_transport: "stdio",
    auth_type: "none",
  });

  assert.equal(input.mcp_transport, "http");
});

test("should treat a stdio row as runnable only while its preset defines the launch", () => {
  const base = {
    type: "mcp_server" as const,
    auth_type: "bearer" as const,
    base_url: null,
    mcp_url: null,
    mcp_transport: "stdio" as const,
    oauth_client_id: null,
    oauth_authorized_at: null,
    oauth_authorize_url: null,
    oauth_token_url: null,
  };

  assert.equal(
    isConnectionMisconfigured({ ...base, source_preset: "trigger" }),
    false
  );
  assert.equal(
    isConnectionMisconfigured({ ...base, source_preset: "linear" }),
    true
  );
  assert.equal(
    isConnectionMisconfigured({ ...base, source_preset: null }),
    true
  );
});

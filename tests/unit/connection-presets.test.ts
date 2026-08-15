import assert from "node:assert/strict";
import test from "node:test";
import {
  CONNECTION_PRESETS,
  CONNECTION_PRESET_MANUAL_HINT,
  getConnectionAuthorizationPath,
  getConnectionPresetAuthorizationDescription,
  getConnectionPreset,
} from "../../lib/connections/presets";

test("quick-add presets only include the verified provider set", () => {
  assert.deepEqual(
    CONNECTION_PRESETS.map((preset) => preset.id),
    [
      "zapier",
      "notion",
      "supabase",
      "browserbase",
      "sentry",
      "sanity",
      "linear",
    ]
  );

  assert.equal(getConnectionPreset("notion")?.auth_type, "oauth");
  assert.equal(getConnectionPreset("zapier")?.auth_type, "none");
  assert.equal(getConnectionPreset("sentry")?.auth_type, "oauth");
});

test("verified presets keep their expected transport and auth metadata", () => {
  assert.deepEqual(
    CONNECTION_PRESETS.map((preset) => ({
      id: preset.id,
      mcp_url: preset.mcp_url ?? null,
      mcp_transport: preset.mcp_transport,
      auth_type: preset.auth_type,
      mcp_url_field: preset.mcp_url_field ?? null,
      credential_binding: preset.credential_binding ?? null,
    })),
    [
      {
        id: "zapier",
        mcp_url: null,
        mcp_transport: "http",
        auth_type: "none",
        mcp_url_field: {
          label: "Zapier MCP Server URL",
          placeholder: "https://mcp.zapier.com/...",
          secret: true,
        },
        credential_binding: null,
      },
      {
        id: "notion",
        mcp_url: "https://mcp.notion.com/mcp",
        mcp_transport: "http",
        auth_type: "oauth",
        mcp_url_field: null,
        credential_binding: null,
      },
      {
        id: "supabase",
        mcp_url: "https://mcp.supabase.com/mcp",
        mcp_transport: "http",
        auth_type: "bearer",
        mcp_url_field: null,
        credential_binding: null,
      },
      {
        id: "browserbase",
        mcp_url: "https://mcp.browserbase.com/mcp",
        mcp_transport: "http",
        auth_type: "api_key",
        mcp_url_field: null,
        credential_binding: {
          location: "query",
          key: "browserbaseApiKey",
        },
      },
      {
        id: "sentry",
        mcp_url: "https://mcp.sentry.dev/mcp",
        mcp_transport: "http",
        auth_type: "oauth",
        mcp_url_field: null,
        credential_binding: null,
      },
      {
        id: "sanity",
        mcp_url: "https://mcp.sanity.io",
        mcp_transport: "http",
        auth_type: "bearer",
        mcp_url_field: null,
        credential_binding: null,
      },
      {
        id: "linear",
        mcp_url: "https://mcp.linear.app/mcp",
        mcp_transport: "http",
        auth_type: "bearer",
        mcp_url_field: null,
        credential_binding: null,
      },
    ]
  );
});

test("manual setup hint calls out removed advanced providers", () => {
  assert.match(CONNECTION_PRESET_MANUAL_HINT, /Add Connection/);
});

test("oauth presets route through Mogplex native OAuth authorization", () => {
  assert.equal(
    getConnectionAuthorizationPath({
      connectionId: "conn-sentry",
      sourcePreset: "sentry",
    }),
    "/api/connections/oauth?connectionId=conn-sentry"
  );
  assert.equal(
    getConnectionAuthorizationPath({
      connectionId: "conn-notion",
      sourcePreset: "notion",
    }),
    "/api/connections/oauth?connectionId=conn-notion"
  );
  assert.match(
    getConnectionPresetAuthorizationDescription(getConnectionPreset("sentry")),
    /Mogplex will discover the MCP auth server/
  );

  assert.deepEqual(getConnectionPreset("sentry")?.oauth_config, {
    discovery: "rfc9728",
    registration: "dynamic",
    use_pkce: true,
    token_endpoint_auth_method: "none",
    scopes: ["org:read", "project:write", "team:write", "event:write"],
  });
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  CONNECTION_PRESETS,
  CONNECTION_PRESET_MANUAL_HINT,
  getConnectionAuthorizationPath,
  getConnectionPresetAuthorizationDescription,
  getConnectionPreset,
  getStdioConnectionPresetDescription,
  isStdioConnectionPreset,
} from "../../lib/connections/presets";

test("quick-add presets only include the verified provider set", () => {
  assert.deepEqual(
    CONNECTION_PRESETS.map((preset) => preset.id),
    [
      "zapier",
      "notion",
      "supabase",
      "neon",
      "browserbase",
      "sentry",
      "sanity",
      "linear",
      "trigger",
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
        id: "neon",
        mcp_url: "https://mcp.neon.tech/mcp",
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
      {
        id: "trigger",
        mcp_url: null,
        mcp_transport: "stdio",
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
    }),
    "/api/connections/oauth?connectionId=conn-sentry"
  );
  assert.equal(
    getConnectionAuthorizationPath({
      connectionId: "conn-notion",
    }),
    "/api/connections/oauth?connectionId=conn-notion"
  );
  assert.match(
    getConnectionPresetAuthorizationDescription(),
    /Mogplex will discover the MCP auth server/
  );

  assert.deepEqual(getConnectionPreset("sentry")?.oauth_config, {
    discovery: "rfc9728",
    registration: "dynamic",
    use_pkce: true,
    use_resource_indicator: true,
    token_endpoint_auth_method: "none",
    scopes: ["org:read", "project:write", "team:write", "event:write"],
  });
});

test("should launch the Trigger.dev preset as a fixed stdio command when it is added", () => {
  const preset = getConnectionPreset("trigger");

  assert.equal(isStdioConnectionPreset(preset), true);
  assert.deepEqual(preset?.stdio, {
    command: "npx",
    args: ["-y", "trigger.dev@latest", "mcp"],
    credential_env: "TRIGGER_ACCESS_TOKEN",
    credential_check: { url: "https://api.trigger.dev/api/v2/whoami" },
  });
});

test("should back the Trigger.dev preset with API tools and link to where its token is made", () => {
  const preset = getConnectionPreset("trigger");

  assert.equal(preset?.api_toolset, "trigger");
  assert.equal(
    preset?.credential_url,
    "https://cloud.trigger.dev/account/tokens"
  );
});

test("should tell the user the tools need no sandbox when a stdio preset has API tools", () => {
  const withApiTools = getStdioConnectionPresetDescription({
    api_toolset: "trigger",
  });
  const stdioOnly = getStdioConnectionPresetDescription({});

  assert.match(withApiTools, /no sandbox needed/);
  assert.match(withApiTools, /sandboxes and the Mogplex CLI/);
  assert.doesNotMatch(stdioOnly, /no sandbox needed/);
  assert.match(stdioOnly, /sandboxes and the Mogplex CLI/);
});

test("should only treat presets with a launch spec as stdio", () => {
  const remotePresets = CONNECTION_PRESETS.filter(
    (preset) => preset.id !== "trigger"
  );

  assert.equal(remotePresets.some(isStdioConnectionPreset), false);
  assert.equal(isStdioConnectionPreset(null), false);
});

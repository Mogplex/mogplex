export type ConnectionPreset = {
  id: string;
  name: string;
  description: string;
  mcp_url?: string;
  mcp_transport: "http" | "sse";
  auth_type: "bearer" | "api_key" | "oauth" | "none";
  oauth_flow?: "dynamic" | "pipedream_connect";
  mcp_url_field?: {
    label: string;
    placeholder: string;
    secret?: boolean;
  };
  oauth_config?: {
    discovery: "rfc9470";
    registration: "dynamic";
    use_pkce: boolean;
    token_endpoint_auth_method: "none" | "client_secret_post";
    authorize_params?: Record<string, string>;
    scopes?: string[];
  };
  credential_binding?: {
    location: "query";
    key: string;
  };
  auth_fields: {
    key: string;
    label: string;
    placeholder: string;
    secret?: boolean;
  }[];
  docs_url: string;
};

export const CONNECTION_PRESET_MANUAL_HINT =
  "Need another advanced MCP? Use Add Connection instead.";

export const CONNECTION_PRESETS: ConnectionPreset[] = [
  {
    id: "zapier",
    name: "Zapier",
    description: "User-specific Zapier MCP server and tool actions",
    mcp_transport: "http",
    auth_type: "none",
    mcp_url_field: {
      label: "Zapier MCP Server URL",
      placeholder: "https://mcp.zapier.com/...",
      secret: true,
    },
    auth_fields: [],
    docs_url:
      "https://help.zapier.com/hc/en-us/articles/36265392843917-Use-Zapier-MCP-with-your-client",
  },
  {
    id: "notion",
    name: "Notion",
    description: "Workspace search, pages, databases, and comments",
    mcp_url: "https://mcp.notion.com/mcp",
    mcp_transport: "http",
    auth_type: "oauth",
    oauth_flow: "dynamic",
    oauth_config: {
      discovery: "rfc9470",
      registration: "dynamic",
      use_pkce: true,
      token_endpoint_auth_method: "none",
      authorize_params: {
        prompt: "consent",
      },
    },
    auth_fields: [],
    docs_url: "https://developers.notion.com/guides/mcp/build-mcp-client",
  },
  {
    id: "supabase",
    name: "Supabase",
    description: "Database, auth, storage, and edge functions",
    mcp_url: "https://mcp.supabase.com/mcp",
    mcp_transport: "http",
    auth_type: "bearer",
    auth_fields: [
      {
        key: "credential",
        label: "Personal Access Token",
        placeholder: "sbp_...",
        secret: true,
      },
    ],
    docs_url: "https://supabase.com/docs/guides/getting-started/mcp",
  },
  {
    id: "browserbase",
    name: "Browserbase",
    description: "Cloud browser automation and scraping",
    mcp_url: "https://mcp.browserbase.com/mcp",
    mcp_transport: "http",
    auth_type: "api_key",
    credential_binding: {
      location: "query",
      key: "browserbaseApiKey",
    },
    auth_fields: [
      {
        key: "credential",
        label: "API Key",
        placeholder: "bb_live_...",
        secret: true,
      },
    ],
    docs_url: "https://docs.browserbase.com/integrations/mcp/setup",
  },
  {
    id: "sentry",
    name: "Sentry",
    description: "Error tracking, performance monitoring, session replay",
    mcp_url: "https://mcp.sentry.dev/mcp",
    mcp_transport: "http",
    auth_type: "oauth",
    oauth_flow: "pipedream_connect",
    auth_fields: [], // credentials are brokered via Pipedream Connect
    docs_url: "https://docs.sentry.io/product/sentry-mcp/",
  },
  {
    id: "sanity",
    name: "Sanity CMS",
    description: "Structured content, media, and releases",
    mcp_url: "https://mcp.sanity.io",
    mcp_transport: "http",
    auth_type: "bearer",
    auth_fields: [
      {
        key: "credential",
        label: "API Token",
        placeholder: "Sanity API token",
        secret: true,
      },
    ],
    docs_url: "https://www.sanity.io/docs/ai/mcp-server",
  },
  {
    id: "linear",
    name: "Linear",
    description: "Issues, projects, cycles, and team workflows",
    mcp_url: "https://mcp.linear.app/mcp",
    mcp_transport: "http",
    auth_type: "bearer",
    auth_fields: [
      {
        key: "credential",
        label: "API Key or Access Token",
        placeholder: "lin_api_...",
        secret: true,
      },
    ],
    docs_url: "https://linear.app/docs/mcp",
  },
];

export function getConnectionPreset(
  presetId: string | null | undefined
): ConnectionPreset | null {
  if (!presetId) return null;
  return CONNECTION_PRESETS.find((preset) => preset.id === presetId) ?? null;
}

export function usesManagedConnectionAuth(
  preset: Pick<ConnectionPreset, "auth_type" | "oauth_flow"> | null | undefined
) {
  return (
    preset?.auth_type === "oauth" && preset.oauth_flow === "pipedream_connect"
  );
}

export function getConnectionAuthorizationPath(input: {
  connectionId: string;
  sourcePreset?: string | null;
}) {
  const preset = getConnectionPreset(input.sourcePreset);
  const path = usesManagedConnectionAuth(preset)
    ? "/api/connections/managed-auth"
    : "/api/connections/oauth";
  return `${path}?connectionId=${encodeURIComponent(input.connectionId)}`;
}

export function getConnectionPresetAuthorizationDescription(
  preset: Pick<ConnectionPreset, "auth_type" | "oauth_flow"> | null | undefined
) {
  if (usesManagedConnectionAuth(preset)) {
    return "Connect through the provider OAuth flow. Mogplex uses Pipedream Connect to manage the authorization and refresh the access token for Sentry.";
  }

  return "Connect through the provider OAuth flow. Mogplex will discover the MCP auth server and register the client automatically.";
}

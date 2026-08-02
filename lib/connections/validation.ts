import { getConnectionPreset } from "./presets";
import { assertSafeOutboundHttpUrl } from "@/lib/security/outbound-url";
import type { Connection } from "@/lib/types";

type ConnectionWriteInput = {
  name: string;
  type: "rest_api" | "mcp_server";
  base_url?: string;
  auth_type?: "none" | "api_key" | "bearer" | "basic" | "oauth";
  auth_header?: string;
  mcp_transport?: "http" | "sse";
  mcp_url?: string;
  credentials?: string;
  description?: string;
  scope?: "global" | "project";
  repo_id?: string;
  oauth_client_id?: string;
  oauth_authorize_url?: string;
  oauth_token_url?: string;
  oauth_scopes?: string;
  source_preset?: string;
};

const VALID_AUTH_TYPES = new Set([
  "none",
  "api_key",
  "bearer",
  "basic",
  "oauth",
]);

export class ConnectionValidationError extends Error {
  status: number;
  code: string;

  constructor(message: string, code = "INVALID_CONNECTION", status = 400) {
    super(message);
    this.name = "ConnectionValidationError";
    this.status = status;
    this.code = code;
  }
}

function asTrimmedString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function optionalTrimmed(value: unknown) {
  const trimmed = asTrimmedString(value);
  return trimmed || undefined;
}

function ensureHttpUrl(value: string, fieldName: string) {
  try {
    return assertSafeOutboundHttpUrl(value, fieldName);
  } catch (error) {
    if (error instanceof Error) {
      throw new ConnectionValidationError(error.message);
    }
    throw error;
  }
}

function getDefaultAuthHeader(authType: Connection["auth_type"]) {
  return authType === "api_key" ? "X-API-Key" : "Authorization";
}

function normalizeOauthCredentials(credentials: string) {
  try {
    const parsed = JSON.parse(credentials) as Record<string, unknown>;
    if (
      typeof parsed.client_secret === "string" &&
      parsed.client_secret.trim()
    ) {
      return JSON.stringify({
        client_secret: parsed.client_secret.trim(),
        ...(typeof parsed.access_token === "string" && parsed.access_token
          ? { access_token: parsed.access_token }
          : {}),
        ...(typeof parsed.refresh_token === "string" && parsed.refresh_token
          ? { refresh_token: parsed.refresh_token }
          : {}),
      });
    }
  } catch {
    // Manual settings/workspace input may provide the raw client secret.
  }

  if (!credentials.trim()) {
    throw new ConnectionValidationError("OAuth client secret is required");
  }

  return JSON.stringify({ client_secret: credentials.trim() });
}

export function normalizeConnectionCreateInput(
  input: unknown
): ConnectionWriteInput {
  if (typeof input !== "object" || input == null) {
    throw new ConnectionValidationError("Connection payload is required");
  }

  const raw = input as Record<string, unknown>;
  const sourcePreset = optionalTrimmed(raw.source_preset);
  const scope = raw.scope === "project" ? "project" : "global";
  const repoId = scope === "project" ? optionalTrimmed(raw.repo_id) : undefined;
  const description = optionalTrimmed(raw.description);

  if (scope === "project" && !repoId) {
    throw new ConnectionValidationError(
      "repo_id is required for project-scoped connections"
    );
  }

  if (sourcePreset) {
    const preset = getConnectionPreset(sourcePreset);
    if (!preset) {
      throw new ConnectionValidationError("Unknown connection preset");
    }

    const credential = asTrimmedString(raw.credentials);
    const rawPresetMcpUrl = asTrimmedString(raw.mcp_url);
    const presetMcpUrl = preset.mcp_url_field
      ? ensureHttpUrl(
          rawPresetMcpUrl ||
            (() => {
              throw new ConnectionValidationError(
                `${preset.name} requires the full MCP server URL`
              );
            })(),
          "mcp_url"
        )
      : preset.mcp_url;

    if (preset.auth_fields.length > 0 && !credential) {
      throw new ConnectionValidationError(
        `${preset.name} requires a credential`
      );
    }

    return {
      name: preset.name,
      type: "mcp_server",
      auth_type: preset.auth_type,
      auth_header: getDefaultAuthHeader(preset.auth_type),
      mcp_transport: preset.mcp_transport,
      mcp_url: presetMcpUrl,
      credentials:
        preset.auth_type === "oauth"
          ? credential
            ? normalizeOauthCredentials(credential)
            : undefined
          : credential || undefined,
      description: description ?? preset.description,
      scope,
      repo_id: repoId,
      oauth_client_id:
        preset.oauth_config?.registration === "dynamic" ? undefined : undefined,
      oauth_authorize_url: undefined,
      oauth_token_url: undefined,
      oauth_scopes: preset.oauth_config?.scopes?.join(" "),
      source_preset: preset.id,
    };
  }

  const type =
    raw.type === "mcp_server"
      ? "mcp_server"
      : raw.type === "rest_api"
        ? "rest_api"
        : null;
  if (!type) {
    throw new ConnectionValidationError(
      "Connection type must be rest_api or mcp_server"
    );
  }

  const name = asTrimmedString(raw.name);
  if (!name) {
    throw new ConnectionValidationError("Connection name is required");
  }

  const authType = optionalTrimmed(raw.auth_type) || "none";
  if (!VALID_AUTH_TYPES.has(authType)) {
    throw new ConnectionValidationError("Unsupported auth type");
  }

  const credentials = asTrimmedString(raw.credentials);
  const authHeader = optionalTrimmed(raw.auth_header);

  if (type === "rest_api") {
    const baseUrl = ensureHttpUrl(asTrimmedString(raw.base_url), "base_url");

    if (authType === "oauth") {
      return {
        name,
        type,
        base_url: baseUrl,
        auth_type: "oauth",
        auth_header: authHeader ?? getDefaultAuthHeader("oauth"),
        credentials: normalizeOauthCredentials(credentials),
        description,
        scope,
        repo_id: repoId,
        oauth_client_id:
          optionalTrimmed(raw.oauth_client_id) ??
          (() => {
            throw new ConnectionValidationError("oauth_client_id is required");
          })(),
        oauth_authorize_url: ensureHttpUrl(
          asTrimmedString(raw.oauth_authorize_url),
          "oauth_authorize_url"
        ),
        oauth_token_url: ensureHttpUrl(
          asTrimmedString(raw.oauth_token_url),
          "oauth_token_url"
        ),
        oauth_scopes: optionalTrimmed(raw.oauth_scopes),
      };
    }

    if (authType !== "none" && !credentials) {
      throw new ConnectionValidationError(
        "Credential is required for authenticated REST connections"
      );
    }

    return {
      name,
      type,
      base_url: baseUrl,
      auth_type: authType as ConnectionWriteInput["auth_type"],
      auth_header:
        authType === "bearer" || authType === "api_key"
          ? (authHeader ??
            getDefaultAuthHeader(authType as Connection["auth_type"]))
          : undefined,
      credentials: authType === "none" ? undefined : credentials,
      description,
      scope,
      repo_id: repoId,
    };
  }

  const mcpUrl = ensureHttpUrl(asTrimmedString(raw.mcp_url), "mcp_url");
  const mcpTransport = raw.mcp_transport === "sse" ? "sse" : "http";

  if (authType === "oauth") {
    return {
      name,
      type,
      auth_type: "oauth",
      auth_header: authHeader ?? getDefaultAuthHeader("oauth"),
      mcp_transport: mcpTransport,
      mcp_url: mcpUrl,
      credentials: normalizeOauthCredentials(credentials),
      description,
      scope,
      repo_id: repoId,
      oauth_client_id:
        optionalTrimmed(raw.oauth_client_id) ??
        (() => {
          throw new ConnectionValidationError("oauth_client_id is required");
        })(),
      oauth_authorize_url: ensureHttpUrl(
        asTrimmedString(raw.oauth_authorize_url),
        "oauth_authorize_url"
      ),
      oauth_token_url: ensureHttpUrl(
        asTrimmedString(raw.oauth_token_url),
        "oauth_token_url"
      ),
      oauth_scopes: optionalTrimmed(raw.oauth_scopes),
    };
  }

  if (authType !== "none" && !credentials) {
    throw new ConnectionValidationError(
      "Credential is required for authenticated MCP connections"
    );
  }

  return {
    name,
    type,
    auth_type: authType as ConnectionWriteInput["auth_type"],
    auth_header:
      authType === "bearer" || authType === "api_key"
        ? (authHeader ??
          getDefaultAuthHeader(authType as Connection["auth_type"]))
        : undefined,
    mcp_transport: mcpTransport,
    mcp_url: mcpUrl,
    credentials: authType === "none" ? undefined : credentials,
    description,
    scope,
    repo_id: repoId,
  };
}

export function isConnectionMisconfigured(
  connection: Pick<
    Connection,
    | "type"
    | "auth_type"
    | "base_url"
    | "mcp_url"
    | "mcp_transport"
    | "oauth_client_id"
    | "oauth_authorize_url"
    | "oauth_token_url"
    | "source_preset"
  >
) {
  if (connection.type === "rest_api" && !connection.base_url) return true;
  if (
    connection.type === "mcp_server" &&
    (!connection.mcp_url || !connection.mcp_transport)
  )
    return true;
  if (connection.auth_type === "oauth") {
    const preset = getConnectionPreset(connection.source_preset);
    if (preset?.oauth_flow === "pipedream_connect") {
      return false;
    }
    if (preset?.oauth_config?.registration === "dynamic") {
      return false;
    }
    return (
      !connection.oauth_client_id ||
      !connection.oauth_authorize_url ||
      !connection.oauth_token_url
    );
  }
  return false;
}

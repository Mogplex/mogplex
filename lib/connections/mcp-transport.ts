import { getConnectionPreset, isStdioConnectionPreset } from "./presets";
import type { Connection } from "@/lib/types";

type McpTransport =
  | { type: "http"; url: string; headers: Record<string, string> }
  | { type: "sse"; url: string; headers: Record<string, string> };

export type McpStdioLaunch = {
  type: "stdio";
  command: string;
  args: string[];
  env: Record<string, string>;
};

/**
 * Stdio connections launch a local process, so only runtimes that own a
 * filesystem (sandbox harnesses, the CLI) can run them.
 */
export function isStdioConnection(
  conn: Pick<Connection, "mcp_transport">
): boolean {
  return conn.mcp_transport === "stdio";
}

/**
 * Launch spec for a stdio connection. The command and args come from the
 * preset definition only; a row whose preset is missing or not stdio returns
 * null rather than running anything.
 */
export function buildMcpStdioLaunch(
  conn: Pick<Connection, "mcp_transport" | "source_preset">,
  credential?: string
): McpStdioLaunch | null {
  if (!isStdioConnection(conn)) return null;
  const preset = getConnectionPreset(conn.source_preset);
  if (!isStdioConnectionPreset(preset)) return null;

  return {
    type: "stdio",
    command: preset.stdio.command,
    args: [...preset.stdio.args],
    env: credential ? { [preset.stdio.credential_env]: credential } : {},
  };
}

function getDefaultAuthHeader(authType: Connection["auth_type"]) {
  return authType === "api_key" ? "X-API-Key" : "Authorization";
}

function resolveEffectiveAuthType(conn: Connection, credential?: string) {
  if (conn.auth_type === "none" && credential) {
    // Older settings-created MCP connections stored a credential while leaving
    // auth_type at "none". Keep treating those as bearer tokens.
    return "bearer" as const;
  }

  return conn.auth_type;
}

export function buildConnectionAuthHeaders(
  conn: Pick<Connection, "auth_type" | "auth_header">,
  credential?: string
) {
  const headers: Record<string, string> = {};
  if (!credential) return headers;

  const authType = conn.auth_type;
  const authHeader = conn.auth_header || getDefaultAuthHeader(authType);

  switch (authType) {
    case "bearer":
    case "oauth": {
      headers[authHeader] = `Bearer ${credential}`;

      break;
    }
    case "api_key": {
      headers[authHeader] = credential;

      break;
    }
    case "basic": {
      headers[authHeader] = `Basic ${credential}`;

      break;
    }
    // No default
  }

  return headers;
}

/** Remote (http/sse) transport. Stdio connections use buildMcpStdioLaunch. */
export function buildMcpTransport(
  conn: Connection,
  credential?: string
): McpTransport {
  if (isStdioConnection(conn)) {
    throw new Error(`${conn.name} runs over stdio and has no remote transport`);
  }

  const preset = getConnectionPreset(conn.source_preset);
  const headers: Record<string, string> = {};
  let url = conn.mcp_url ?? "";

  if (credential) {
    if (preset?.credential_binding?.location === "query") {
      const nextUrl = new URL(url);
      nextUrl.searchParams.set(preset.credential_binding.key, credential);
      url = nextUrl.toString();
    } else {
      const authType = resolveEffectiveAuthType(conn, credential);
      Object.assign(
        headers,
        buildConnectionAuthHeaders(
          {
            auth_type: authType,
            auth_header: conn.auth_header,
          },
          credential
        )
      );
    }
  }

  return conn.mcp_transport === "sse"
    ? { type: "sse", url, headers }
    : { type: "http", url, headers };
}

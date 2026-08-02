/* eslint-disable unicorn/prefer-top-level-await */
import { MOGPLEX_MCP_PROTOCOL_VERSION } from "../lib/mogplex-api/mcp";

type JsonRpcResponse =
  | {
      jsonrpc: "2.0";
      id: string | number | null;
      result: unknown;
    }
  | {
      jsonrpc: "2.0";
      id?: string | number | null;
      error: {
        code: number;
        message: string;
        data?: unknown;
      };
    };

function requireEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function resolveMcpUrl() {
  const explicit = process.env.MOGPLEX_MCP_URL?.trim();
  if (explicit) return explicit;

  const apiUrl = process.env.MOGPLEX_API_URL?.trim() || "http://localhost:3000";
  return new URL("/api/v1/mogplex/mcp", apiUrl).toString();
}

function normalizeAuthorization(token: string) {
  return token.startsWith("Bearer ") ? token : `Bearer ${token}`;
}

async function postMcp(input: {
  url: string;
  authorization: string;
  id: number;
  method: string;
  params?: Record<string, unknown>;
}): Promise<JsonRpcResponse> {
  const response = await fetch(input.url, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      authorization: input.authorization,
      "content-type": "application/json",
      "mcp-protocol-version": MOGPLEX_MCP_PROTOCOL_VERSION,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: input.id,
      method: input.method,
      ...(input.params ? { params: input.params } : {}),
    }),
  });
  const payload = (await response.json()) as JsonRpcResponse;
  if (!response.ok || "error" in payload) {
    const message =
      "error" in payload
        ? payload.error.message
        : `HTTP ${response.status} from Mogplex MCP`;
    throw new Error(message);
  }
  return payload;
}

async function main() {
  const url = resolveMcpUrl();
  const authorization = normalizeAuthorization(requireEnv("MOGPLEX_API_TOKEN"));

  const initialize = await postMcp({
    url,
    authorization,
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: MOGPLEX_MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: "mogplex-mcp-smoke",
        version: "0.1.0",
      },
    },
  });
  const tools = await postMcp({
    url,
    authorization,
    id: 2,
    method: "tools/list",
  });
  const repos = await postMcp({
    url,
    authorization,
    id: 3,
    method: "tools/call",
    params: {
      name: "mogplex_list_repos",
      arguments: {
        limit: 5,
      },
    },
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        url,
        initialize: "result" in initialize ? initialize.result : null,
        tools: "result" in tools ? tools.result : null,
        repos: "result" in repos ? repos.result : null,
      },
      null,
      2
    )
  );
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  // Force-exit so pending fetch handles cannot keep failed CI smoke runs alive.
  process.exit(1);
});

import {
  McpToolArgumentError,
  type JsonRpcErrorResponse,
  type JsonRpcId,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type JsonRpcResultResponse,
  type McpToolDefinition,
  type MogplexMcpContext,
  type ToolCallParams,
} from "./mcp-types";
import { MCP_TOOLS_INFRA } from "./mcp-tool-defs-infra";
import { MCP_TOOLS_AUTOMATION } from "./mcp-tool-defs-automation";
import { MCP_TOOLS_RUN } from "./mcp-tool-defs-run";
import { callMogplexTool } from "./mcp-handlers";

// Re-export public types and constants
export type { MogplexMcpClient } from "./mcp-types";
export { emptyObjectSchema as MOGPLEX_MCP_EMPTY_OBJECT_SCHEMA } from "./mcp-schemas";

export const MOGPLEX_MCP_PROTOCOL_VERSION = "2025-11-25";
export const MOGPLEX_MCP_SERVER_NAME = "mogplex";
export const MOGPLEX_MCP_SERVER_VERSION = "0.1.0";

export const MOGPLEX_MCP_TOOLS: McpToolDefinition[] = [
  ...MCP_TOOLS_INFRA,
  ...MCP_TOOLS_AUTOMATION,
  ...MCP_TOOLS_RUN,
];

export type MogplexMcpToolName = (typeof MOGPLEX_MCP_TOOLS)[number]["name"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonRpcResult(id: JsonRpcId, result: unknown): JsonRpcResultResponse {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

export function jsonRpcError(
  id: JsonRpcId | undefined,
  code: number,
  message: string,
  data?: unknown
): JsonRpcErrorResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data }),
    },
  };
}

function getJsonRpcId(value: unknown): JsonRpcId | undefined {
  if (!isRecord(value) || !("id" in value)) return undefined;
  const id = value.id;
  if (typeof id === "string" || typeof id === "number" || id === null) {
    return id;
  }
  return null;
}

function getJsonRpcIdSafely(value: unknown): JsonRpcId | undefined {
  try {
    return getJsonRpcId(value);
  } catch {
    return undefined;
  }
}

function parseJsonRpcRequest(
  value: unknown
): JsonRpcErrorResponse | JsonRpcRequest {
  const id = getJsonRpcId(value);
  if (!isRecord(value)) {
    return jsonRpcError(null, -32600, "Invalid Request");
  }
  if (value.jsonrpc !== "2.0" || typeof value.method !== "string") {
    return jsonRpcError(id ?? null, -32600, "Invalid Request");
  }
  return value as JsonRpcRequest;
}

function parseToolCallParams(params: unknown): ToolCallParams {
  if (!isRecord(params) || typeof params.name !== "string") {
    throw new McpToolArgumentError("tools/call requires params.name");
  }
  if (
    params.arguments !== undefined &&
    params.arguments !== null &&
    !isRecord(params.arguments)
  ) {
    throw new McpToolArgumentError(
      "tools/call params.arguments must be an object"
    );
  }

  return {
    name: params.name,
    arguments: params.arguments ?? {},
  };
}

function initializeResult() {
  return {
    protocolVersion: MOGPLEX_MCP_PROTOCOL_VERSION,
    capabilities: {
      tools: {
        listChanged: false,
      },
    },
    serverInfo: {
      name: MOGPLEX_MCP_SERVER_NAME,
      version: MOGPLEX_MCP_SERVER_VERSION,
    },
    instructions:
      "Use Mogplex tools to discover repos, agents, and models; manage env vars on a repo's linked Vercel project; build, publish, trigger, and inspect automations; rerun the Mogplex PR review on a pull request; create sandboxes and read their logs; or start and control one-off repo-bound agent runs.",
  };
}

export async function handleMogplexMcpMessage(
  payload: unknown,
  context: MogplexMcpContext
): Promise<JsonRpcResponse | null> {
  const parsed = parseJsonRpcRequest(payload);
  if ("error" in parsed) return parsed;
  if (!("id" in parsed)) return null;

  switch (parsed.method) {
    case "initialize":
      return jsonRpcResult(parsed.id ?? null, initializeResult());
    case "ping":
      return jsonRpcResult(parsed.id ?? null, {});
    case "tools/list":
      return jsonRpcResult(parsed.id ?? null, {
        tools: MOGPLEX_MCP_TOOLS,
      });
    case "tools/call": {
      try {
        const params = parseToolCallParams(parsed.params);
        const result = await callMogplexTool(
          params.name,
          params.arguments,
          context
        );
        return jsonRpcResult(parsed.id ?? null, result);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Invalid tool arguments";
        return jsonRpcError(parsed.id ?? null, -32602, message);
      }
    }
    default:
      return jsonRpcError(
        parsed.id ?? null,
        -32601,
        `Method not found: ${parsed.method}`
      );
  }
}

async function handleMogplexMcpMessageSafely(
  payload: unknown,
  context: MogplexMcpContext
) {
  try {
    return await handleMogplexMcpMessage(payload, context);
  } catch (error) {
    console.error("[mogplex-mcp] unexpected message failure", { error });
    return jsonRpcError(
      getJsonRpcIdSafely(payload) ?? null,
      -32603,
      "Mogplex MCP request failed",
      {
        code: "INTERNAL_ERROR",
      }
    );
  }
}

function isJsonRpcResponse(
  message: JsonRpcResponse | null
): message is JsonRpcResponse {
  return message !== null;
}

export async function handleMogplexMcpPayload(
  payload: unknown,
  context: MogplexMcpContext
): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
  if (!Array.isArray(payload)) {
    // The API route authenticates once before dispatch. Keep the wrapper here
    // only to convert per-message parser/tool crashes into JSON-RPC errors.
    return handleMogplexMcpMessageSafely(payload, context);
  }
  if (payload.length === 0) {
    return jsonRpcError(null, -32600, "Invalid Request");
  }

  // The hosted route authenticates the bearer token once before dispatching
  // the batch. Keep auth at that boundary so individual messages cannot
  // partially succeed under different credentials.
  const responses = (
    await Promise.all(
      payload.map((message) => handleMogplexMcpMessageSafely(message, context))
    )
  ).filter(isJsonRpcResponse);

  return responses.length > 0 ? responses : null;
}

import type { MogplexApiClient } from "./client";

export type JsonRpcId = number | string | null;

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: unknown;
};

export type JsonRpcResultResponse = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: unknown;
};

export type JsonRpcErrorResponse = {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
};

export type JsonRpcResponse = JsonRpcErrorResponse | JsonRpcResultResponse;

export type McpTextContent = {
  type: "text";
  text: string;
};

export type McpToolResult = {
  content: McpTextContent[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

export type McpToolDefinition = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint: boolean;
  };
};

export type ToolCallParams = {
  name: string;
  arguments?: Record<string, unknown>;
};

export type MogplexMcpClient = Pick<
  MogplexApiClient,
  | "cancelRun"
  | "createAutomation"
  | "createSandbox"
  | "deleteRepoEnvVar"
  | "getAutomation"
  | "getAutomationRunLogs"
  | "getRun"
  | "getRunEvents"
  | "getSandboxLogs"
  | "listAgents"
  | "listAutomationRuns"
  | "listAutomations"
  | "listModels"
  | "listRepoEnvVars"
  | "listRepos"
  | "listSandboxes"
  | "publishAutomation"
  | "setAutomationModel"
  | "startAgentRun"
  | "triggerAutomation"
  | "updateAutomation"
  | "upsertRepoEnvVar"
>;

export type MogplexMcpContext = {
  client: MogplexMcpClient;
};

export class McpToolArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpToolArgumentError";
    Object.setPrototypeOf(this, McpToolArgumentError.prototype);
  }
}

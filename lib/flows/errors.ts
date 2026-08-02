export type FlowServiceErrorCode =
  | "FLOW_NOT_FOUND"
  | "FLOW_RUN_NOT_FOUND"
  | "FLOW_INSTALLATION_NOT_FOUND"
  | "FLOW_INVALID_INSTALLATION_ID"
  | "FLOW_AGENT_FORBIDDEN"
  | "FLOW_GRAPH_INVALID"
  | "FLOW_UNPUBLISHED_ACTIVATION"
  | "FLOW_ACTIVATION_IN_PROGRESS"
  | "FLOW_STORAGE_FAILED"
  | "FLOW_ACTIVATION_ROLLBACK_FAILED"
  | "FLOW_PUBLISH_SYNC_FAILED"
  | "FLOW_DELETE_SYNC_FAILED"
  | "FLOW_ASSISTANT_INVALID_GRAPH";

export class FlowServiceError extends Error {
  constructor(
    public code: FlowServiceErrorCode,
    message: string,
    options?: {
      cause?: unknown;
      details?: unknown;
    }
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = "FlowServiceError";
    this.details = options?.details;
  }

  details?: unknown;
}

export function isFlowServiceError(error: unknown): error is FlowServiceError {
  return error instanceof FlowServiceError;
}

export function getFlowServiceErrorStatus(error: FlowServiceError) {
  switch (error.code) {
    case "FLOW_NOT_FOUND":
    case "FLOW_RUN_NOT_FOUND":
    case "FLOW_INSTALLATION_NOT_FOUND":
      return 404;
    case "FLOW_INVALID_INSTALLATION_ID":
    case "FLOW_AGENT_FORBIDDEN":
    case "FLOW_GRAPH_INVALID":
    case "FLOW_UNPUBLISHED_ACTIVATION":
    case "FLOW_ASSISTANT_INVALID_GRAPH":
      return 400;
    case "FLOW_ACTIVATION_IN_PROGRESS":
      return 409;
    case "FLOW_STORAGE_FAILED":
    case "FLOW_ACTIVATION_ROLLBACK_FAILED":
    case "FLOW_PUBLISH_SYNC_FAILED":
    case "FLOW_DELETE_SYNC_FAILED":
      return 500;
    default:
      return 500;
  }
}

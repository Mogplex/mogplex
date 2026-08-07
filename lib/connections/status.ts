import type { ConnectionHealthStatus } from "@/lib/connections/health-status";
import type { Connection } from "@/lib/types";

export {
  CONNECTION_HEALTH_STATUSES,
  type ConnectionHealthStatus,
} from "@/lib/connections/health-status";

export type ConnectionTestResult = {
  healthy: boolean;
  status: ConnectionHealthStatus;
  summary: string;
  testedAt: string;
  error?: string;
  toolCount?: number;
  httpStatus?: number;
};

export function getConnectionStatusLabel(status: ConnectionHealthStatus) {
  switch (status) {
    case "unknown":
      return "Never tested";
    case "testing":
      return "Testing";
    case "healthy":
      return "Healthy";
    case "auth_failed":
      return "Auth failed";
    case "unreachable":
      return "Unreachable";
    case "misconfigured":
      return "Needs setup";
    case "error":
    default:
      return "Error";
  }
}

export function getConnectionStatusTone(status: ConnectionHealthStatus) {
  switch (status) {
    case "healthy":
      return "text-green-500";
    case "auth_failed":
    case "misconfigured":
      return "text-amber-400";
    case "unreachable":
    case "error":
      return "text-red-500";
    case "testing":
      return "text-accent-blue";
    case "unknown":
    default:
      return "text-muted-foreground";
  }
}

function containsOneOf(value: string, patterns: string[]) {
  return patterns.some((pattern) => value.includes(pattern));
}

export function classifyConnectionError(
  error: unknown
): ConnectionHealthStatus {
  const message =
    error instanceof Error
      ? error.message.toLowerCase()
      : String(error).toLowerCase();

  if (
    containsOneOf(message, [
      "invalid url",
      "missing",
      "no credentials",
      "required",
      "configured for oauth",
      "credentials format",
      "client secret",
      "connection type",
    ])
  ) {
    return "misconfigured";
  }

  if (
    containsOneOf(message, [
      "unauthorized",
      "forbidden",
      "invalid token",
      "access token",
      "refresh token",
      "authentication",
      "401",
      "403",
    ])
  ) {
    return "auth_failed";
  }

  if (
    containsOneOf(message, [
      "timed out",
      "timeout",
      "network error",
      "fetch failed",
      "enotfound",
      "econnrefused",
      "econnreset",
      "socket hang up",
    ])
  ) {
    return "unreachable";
  }

  return "error";
}

export function getConnectionStatusDetail(
  connection: Pick<
    Connection,
    | "auth_type"
    | "health_status"
    | "last_test_error"
    | "last_test_http_status"
    | "last_test_tool_count"
    | "oauth_authorized_at"
  >
) {
  if (connection.auth_type === "oauth" && !connection.oauth_authorized_at) {
    return "Connect to authorize this connection";
  }

  if (connection.health_status === "healthy") {
    return connection.last_test_tool_count == null
      ? "Connection test passed"
      : `${connection.last_test_tool_count} tools detected`;
  }

  if (connection.last_test_error) {
    return connection.last_test_error;
  }

  if (connection.last_test_http_status != null) {
    return `HTTP ${connection.last_test_http_status}`;
  }

  if (connection.health_status === "unknown") {
    return "Run a test to verify this connection";
  }

  return getConnectionStatusLabel(connection.health_status);
}

export function formatConnectionLastTested(value: string | null) {
  if (!value) return "Not tested";
  return `Last tested ${new Date(value).toLocaleString()}`;
}

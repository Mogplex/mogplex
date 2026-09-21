import { countConnectionApiTools } from "./api-toolsets";
import { getConnectionPreset, isStdioConnectionPreset } from "./presets";
import type { ConnectionTestResult } from "./status";
import type { Connection } from "@/lib/types";

const CREDENTIAL_CHECK_TIMEOUT_MS = 10_000;

type StdioCheckResult = Omit<ConnectionTestResult, "testedAt">;

/**
 * The API toolset uses the same credential, so a verified token means those
 * tools are live even though the stdio server was never started.
 */
function verifiedResult(
  conn: Pick<Connection, "source_preset">,
  httpStatus: number
): StdioCheckResult {
  const toolCount = countConnectionApiTools(conn);
  if (toolCount == null) {
    return {
      healthy: true,
      status: "healthy",
      summary: "Credential verified",
      httpStatus,
    };
  }
  return {
    healthy: true,
    status: "healthy",
    summary: `${toolCount} tools detected`,
    toolCount,
    httpStatus,
  };
}

/**
 * Test a stdio connection without launching it. The server runs in sandboxes
 * and the CLI, so the only thing worth checking here is the credential, against
 * the fixed provider endpoint the preset names.
 */
export async function checkStdioConnection(
  conn: Pick<Connection, "source_preset">,
  credential: string | undefined,
  fetchImpl: typeof fetch = fetch
): Promise<StdioCheckResult> {
  const preset = getConnectionPreset(conn.source_preset);
  if (!isStdioConnectionPreset(preset)) {
    return {
      healthy: false,
      status: "misconfigured",
      summary: "Preset no longer available",
    };
  }

  if (!credential) {
    return {
      healthy: false,
      status: "auth_failed",
      summary: "Credential missing",
    };
  }

  const check = preset.stdio.credential_check;
  if (!check) {
    return { healthy: true, status: "healthy", summary: "Credential saved" };
  }

  const res = await fetchImpl(check.url, {
    headers: { Authorization: `Bearer ${credential}` },
    signal: AbortSignal.timeout(CREDENTIAL_CHECK_TIMEOUT_MS),
  });

  if (res.ok) return verifiedResult(conn, res.status);

  const rejected = res.status === 401 || res.status === 403;
  return {
    healthy: false,
    status: rejected ? "auth_failed" : "error",
    summary: `HTTP ${res.status}`,
    error: rejected
      ? `${preset.name} rejected the credential`
      : `${preset.name} credential check failed with HTTP ${res.status}`,
    httpStatus: res.status,
  };
}

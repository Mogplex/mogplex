import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { UnsafeOutboundUrlError } from "@/lib/security/outbound-url";
import {
  duringStartup,
  loadSavedServer,
  MissingMcpSecretError,
  SAVED_MCP_STARTUP_TIMEOUT_MS,
  type ChatServerRow,
} from "./chat";
import { toolApproval } from "./policy";
import type { DiagnosticCode, McpDiagnosticResult } from "./diagnostic-result";

function failureCode(error: unknown, signal: AbortSignal): DiagnosticCode {
  if (signal.aborted) return "timeout";
  if (error instanceof z.ZodError) return "invalid_policy";
  if (error instanceof UnsafeOutboundUrlError) return "unsafe_url";
  if (error instanceof MissingMcpSecretError) return "missing_secret";
  const visited = new Set<unknown>();
  let cause = error;
  while (cause && typeof cause === "object" && !visited.has(cause)) {
    visited.add(cause);
    if (
      "statusCode" in cause &&
      (cause.statusCode === 401 || cause.statusCode === 403)
    )
      return "authentication";
    cause = "cause" in cause ? cause.cause : undefined;
  }
  return "connection";
}

export async function getSavedMcpServerForTest(
  userId: string,
  id: string,
  db = supabaseAdmin
) {
  return db
    .from("user_mcp_servers")
    .select(
      "id, name, url, header_refs, header_plain, extra, transport, enabled, updated_at"
    )
    .eq("user_id", userId)
    .eq("id", id)
    .maybeSingle();
}

async function closeDiagnosticSession(
  loading: ReturnType<typeof loadSavedServer>
) {
  try {
    const { loaded } = await loading;
    await loaded.cleanup();
  } catch {
    /* Discovery failures are reported by the caller. */
  }
}

/** Saved definitions only: never accept a caller-supplied URL or secret reference. */
export async function testSavedMcpServer(
  userId: string,
  id: string,
  requestSignal?: AbortSignal
): Promise<McpDiagnosticResult | null> {
  const deadline = new AbortController();
  const cleanup = new AbortController();
  let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
  // Keep the complete test within the existing eight-second connection budget.
  const getCleanupSignal = () => {
    cleanupTimer ??= setTimeout(() => cleanup.abort(), 2000);
    return cleanup.signal;
  };
  let loading: ReturnType<typeof loadSavedServer> | undefined;
  const signal = requestSignal
    ? AbortSignal.any([deadline.signal, requestSignal])
    : deadline.signal;
  const timer = setTimeout(
    () => deadline.abort(),
    SAVED_MCP_STARTUP_TIMEOUT_MS
  );
  let updatedAt = "";
  try {
    const { data, error } = await duringStartup(
      getSavedMcpServerForTest(userId, id),
      signal
    );
    if (error) throw error;
    if (!data) return null;
    const server = data as ChatServerRow & {
      transport: string;
      enabled: boolean;
      updated_at: string;
    };
    updatedAt = server.updated_at;
    if (server.transport !== "http")
      return {
        status: "error",
        code: "cli_only",
        checkedAt: new Date().toISOString(),
        serverUpdatedAt: updatedAt,
      };
    loading = loadSavedServer(server, signal, getCleanupSignal);
    const { loaded, policy } = await duringStartup(loading, signal);
    return {
      status: "success",
      enabled: server.enabled,
      tools: Object.keys(loaded.tools).map((name) => ({
        name,
        approval: toolApproval(policy, name),
      })),
      checkedAt: new Date().toISOString(),
      serverUpdatedAt: updatedAt,
    };
  } catch (error) {
    const code = failureCode(error, signal);
    console.warn("[mcp-servers] Connection test failed", {
      userId,
      serverId: id,
      code,
    });
    return {
      status: "error",
      code,
      checkedAt: new Date().toISOString(),
      serverUpdatedAt: updatedAt,
    };
  } finally {
    clearTimeout(timer);
    deadline.abort();
    if (loading) {
      // Await teardown after success, cancellation, or failure, without masking
      // the discovery result. The same fresh signal bounds its DELETE request.
      await duringStartup(
        closeDiagnosticSession(loading),
        getCleanupSignal()
      ).catch(() => undefined);
    }
    clearTimeout(cleanupTimer);
    cleanup.abort();
  }
}

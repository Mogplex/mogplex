import { NextResponse } from "next/server";
import { createMCPClient } from "@ai-sdk/mcp";
import {
  decrypt,
  isConnectionsEncryptionConfigError,
} from "@/lib/connections/encryption";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  buildConnectionAuthHeaders,
  buildMcpTransport,
} from "@/lib/connections/mcp-transport";
import { requireUserId } from "@/lib/auth";
import { classifyConnectionError } from "@/lib/connections/status";
import { isConnectionMisconfigured } from "@/lib/connections/validation";
import { logConnectionEvent } from "@/lib/connections/logging";
import {
  ConnectionTestPersistenceError,
  ensureConnectionTestWriteSucceeded,
} from "@/lib/connections/test-persistence";
import { assertSafeOutboundHttpUrlWithDns } from "@/lib/security/outbound-url";
import type {
  ConnectionHealthStatus,
  ConnectionTestResult,
} from "@/lib/connections/status";
import type { Connection } from "@/lib/types";

type PersistedConnectionTestResult = ConnectionTestResult & {
  testToken?: string;
};

function createFailureResult(
  status: ConnectionHealthStatus,
  error: string,
  httpStatus?: number
): ConnectionTestResult {
  return {
    healthy: false,
    status,
    summary: error,
    error,
    httpStatus,
    testedAt: new Date().toISOString(),
  };
}

async function persistConnectionTestResult(
  connectionId: string,
  result: PersistedConnectionTestResult
) {
  let query = supabaseAdmin
    .from("connections")
    .update({
      health_status: result.status,
      last_tested_at: result.testedAt,
      last_test_error: result.error ?? null,
      last_test_http_status: result.httpStatus ?? null,
      last_test_tool_count: result.toolCount ?? null,
      active_test_token: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", connectionId);

  if (result.testToken) {
    query = query.eq("active_test_token", result.testToken);
  }

  const { data, error } = await query.select("id").maybeSingle();

  ensureConnectionTestWriteSucceeded(
    error,
    "Connection test completed but the result could not be saved"
  );

  return Boolean(data);
}

async function markConnectionTesting(connectionId: string) {
  const testToken = crypto.randomUUID();
  const { data, error } = await supabaseAdmin
    .from("connections")
    .update({
      health_status: "testing",
      active_test_token: testToken,
      updated_at: new Date().toISOString(),
    })
    .eq("id", connectionId)
    .select("id")
    .maybeSingle();

  ensureConnectionTestWriteSucceeded(
    error,
    "Could not mark connection test as running"
  );

  if (!data) {
    throw new ConnectionTestPersistenceError(
      "Could not mark connection test as running"
    );
  }

  return { testToken };
}

function createPersistFailureResponse(error: ConnectionTestPersistenceError) {
  return NextResponse.json(
    {
      error: error.message,
      code: error.code,
    },
    { status: 500 }
  );
}

function logPersistFailure(
  userId: string,
  conn: Connection,
  error: ConnectionTestPersistenceError,
  result?: ConnectionTestResult
) {
  logConnectionEvent("connection_test_persist_failed", {
    userId,
    repoId: conn.repo_id,
    connectionId: conn.id,
    presetId: conn.source_preset,
    connectionType: conn.type,
    authType: conn.auth_type,
    healthStatus: result?.status,
    httpStatus: result?.httpStatus,
    toolCount: result?.toolCount,
    reason: error.causeMessage ?? error.message,
    surface: "test",
  });
}

async function respondWithPersistedResult(
  userId: string,
  conn: Connection,
  result: PersistedConnectionTestResult
) {
  let persisted: boolean;
  try {
    persisted = await persistConnectionTestResult(conn.id, result);
  } catch (error) {
    if (error instanceof ConnectionTestPersistenceError) {
      logPersistFailure(userId, conn, error, result);
      return createPersistFailureResponse(error);
    }
    throw error;
  }

  const { testToken: _testToken, ...response } = result;
  if (!persisted) {
    return NextResponse.json({
      ...response,
      persisted: false,
      superseded: true,
    });
  }

  logConnectionEvent(
    result.healthy ? "connection_test_succeeded" : "connection_test_failed",
    {
      userId,
      repoId: conn.repo_id,
      connectionId: conn.id,
      presetId: conn.source_preset,
      connectionType: conn.type,
      authType: conn.auth_type,
      healthStatus: result.status,
      httpStatus: result.httpStatus,
      toolCount: result.toolCount,
      reason: result.error,
      // Only the failed branch persists (see EVENT_TO_DB_TYPE), but
      // we set surface unconditionally to keep the call shape uniform
      // — the success branch ignores it.
      surface: "test",
    }
  );

  return NextResponse.json(response);
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  const { data: conn, error } = await supabaseAdmin
    .from("connections")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .single();

  if (error || !conn) {
    return NextResponse.json(
      { error: "Connection not found" },
      { status: 404 }
    );
  }

  let credential: string;
  try {
    credential = conn.encrypted_credentials
      ? decrypt(conn.encrypted_credentials)
      : "";
  } catch (e) {
    if (isConnectionsEncryptionConfigError(e)) {
      return NextResponse.json(
        {
          error:
            "Connections are temporarily unavailable. Please try again in a minute.",
          code: e.code,
        },
        { status: 503 }
      );
    }
    throw e;
  }

  let activeTest: Awaited<ReturnType<typeof markConnectionTesting>>;
  try {
    activeTest = await markConnectionTesting(id);
  } catch (error) {
    if (error instanceof ConnectionTestPersistenceError) {
      logPersistFailure(userId, conn, error);
      return createPersistFailureResponse(error);
    }
    throw error;
  }

  // OAuth connections need a completed authorization before they can be tested.
  if (conn.auth_type === "oauth") {
    if (!conn.oauth_authorized_at) {
      const result: PersistedConnectionTestResult = {
        ...createFailureResult(
          "auth_failed",
          "OAuth authorization required — connect this preset first"
        ),
        testToken: activeTest.testToken,
      };
      return respondWithPersistedResult(userId, conn, result);
    }

    try {
      const { getValidAccessToken } = await import("@/lib/connections/oauth");
      credential = await getValidAccessToken(conn);
    } catch (e) {
      const result: PersistedConnectionTestResult = {
        ...createFailureResult(
          classifyConnectionError(e),
          (e as Error).message
        ),
        testToken: activeTest.testToken,
      };
      return respondWithPersistedResult(userId, conn, result);
    }
  }

  try {
    if (isConnectionMisconfigured(conn)) {
      const result: PersistedConnectionTestResult = {
        ...createFailureResult(
          "misconfigured",
          "Connection configuration is incomplete"
        ),
        testToken: activeTest.testToken,
      };
      return respondWithPersistedResult(userId, conn, result);
    }

    logConnectionEvent("connection_test_started", {
      userId,
      repoId: conn.repo_id,
      connectionId: conn.id,
      presetId: conn.source_preset,
      connectionType: conn.type,
      authType: conn.auth_type,
    });

    if (conn.type === "rest_api") {
      const targetUrl = await assertSafeOutboundHttpUrlWithDns(
        conn.base_url!,
        "base_url"
      );
      const headers = buildConnectionAuthHeaders(conn, credential);
      let res = await fetch(targetUrl, {
        method: "HEAD",
        headers,
        signal: AbortSignal.timeout(10000),
      });

      if (res.status === 405 || res.status === 501) {
        res = await fetch(targetUrl, {
          method: "GET",
          headers,
          signal: AbortSignal.timeout(10000),
        });
      }

      const result: ConnectionTestResult = res.ok
        ? {
            healthy: true,
            status: "healthy",
            summary: `HTTP ${res.status}`,
            httpStatus: res.status,
            testedAt: new Date().toISOString(),
          }
        : createFailureResult(
            res.status === 401 || res.status === 403 ? "auth_failed" : "error",
            `HTTP ${res.status}`,
            res.status
          );

      return respondWithPersistedResult(userId, conn, {
        ...result,
        testToken: activeTest.testToken,
      });
    }

    if (conn.type === "mcp_server") {
      await assertSafeOutboundHttpUrlWithDns(conn.mcp_url!, "mcp_url");
      const client = await createMCPClient({
        transport: buildMcpTransport(conn, credential),
      });
      try {
        const tools = await client.tools();
        const toolCount = Object.keys(tools).length;

        const result: ConnectionTestResult = {
          healthy: true,
          status: "healthy",
          summary: `${toolCount} tools detected`,
          toolCount,
          testedAt: new Date().toISOString(),
        };
        return respondWithPersistedResult(userId, conn, {
          ...result,
          testToken: activeTest.testToken,
        });
      } finally {
        await client.close();
      }
    }

    return NextResponse.json(
      { error: "Unknown connection type" },
      { status: 400 }
    );
  } catch (e) {
    if (e instanceof ConnectionTestPersistenceError) {
      logPersistFailure(userId, conn, e);
      return createPersistFailureResponse(e);
    }

    const result: PersistedConnectionTestResult = {
      ...createFailureResult(classifyConnectionError(e), (e as Error).message),
      testToken: activeTest.testToken,
    };
    return respondWithPersistedResult(userId, conn, result);
  }
}

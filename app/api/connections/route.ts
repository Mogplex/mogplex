import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  getAllUserConnections,
  createConnection,
  updateConnection,
  deleteConnection,
  countResolvedMcps,
  findUserConnectionBySourcePreset,
} from "@/lib/connections/service";
import { MAX_MCP_CONNECTIONS } from "@/lib/connections/constants";
import { requireUserId } from "@/lib/auth";
import { logConnectionEvent } from "@/lib/connections/logging";
import { isConnectionsEncryptionConfigError } from "@/lib/connections/encryption";
import {
  ConnectionValidationError,
  normalizeConnectionCreateInput,
} from "@/lib/connections/validation";

async function verifyConnectionOwnership(connectionId: string, userId: string) {
  const { data } = await supabaseAdmin
    .from("connections")
    .select("user_id")
    .eq("id", connectionId)
    .single();
  return data?.user_id === userId;
}

async function verifyRepoOwnership(repoId: string, userId: string) {
  const { data } = await supabaseAdmin
    .from("repos")
    .select("id")
    .eq("id", repoId)
    .eq("user_id", userId)
    .maybeSingle();

  return Boolean(data?.id);
}

export async function GET() {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  try {
    const connections = await getAllUserConnections(userId);
    return NextResponse.json({ connections });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  try {
    const body = normalizeConnectionCreateInput(await req.json());

    if (body.scope === "project" && body.repo_id) {
      const ownsRepo = await verifyRepoOwnership(body.repo_id, userId);
      if (!ownsRepo) {
        throw new ConnectionValidationError(
          "Repo not found",
          "REPO_NOT_FOUND",
          404
        );
      }
    }

    if (typeof body.source_preset === "string" && body.source_preset) {
      const existing = await findUserConnectionBySourcePreset(
        userId,
        body.source_preset
      );
      if (existing) {
        logConnectionEvent("connection_create_failed", {
          userId,
          presetId: body.source_preset,
          connectionType: body.type,
          authType: body.auth_type,
          repoId: body.repo_id ?? null,
          reason: "preset_already_connected",
        });
        return NextResponse.json(
          {
            error: `${existing.name} is already connected from this preset`,
            code: "PRESET_ALREADY_CONNECTED",
            connection: existing,
          },
          { status: 409 }
        );
      }
    }

    // Enforce MCP cap: for project-scoped, check resolved count for that repo;
    // for global, check total enabled MCP count
    if (body.type === "mcp_server") {
      let mcpCount: number;
      if (body.scope === "project" && body.repo_id) {
        mcpCount = await countResolvedMcps(userId, body.repo_id);
      } else {
        const existing = await getAllUserConnections(userId);
        mcpCount = existing.filter(
          (c) => c.type === "mcp_server" && c.is_enabled
        ).length;
      }
      if (mcpCount >= MAX_MCP_CONNECTIONS) {
        logConnectionEvent("connection_create_failed", {
          userId,
          presetId: body.source_preset ?? null,
          connectionType: body.type,
          authType: body.auth_type,
          repoId: body.repo_id ?? null,
          reason: "mcp_cap_reached",
        });
        return NextResponse.json(
          { error: `Maximum ${MAX_MCP_CONNECTIONS} MCP connections allowed` },
          { status: 400 }
        );
      }
    }

    const connection = await createConnection(userId, body);
    logConnectionEvent("connection_created", {
      userId,
      repoId: connection.repo_id,
      connectionId: connection.id,
      presetId: connection.source_preset,
      connectionType: connection.type,
      authType: connection.auth_type,
    });
    return NextResponse.json({ connection }, { status: 201 });
  } catch (e) {
    const error = e as Error & { status?: number; code?: string };
    logConnectionEvent("connection_create_failed", {
      userId,
      reason: error.message,
    });
    if (isConnectionsEncryptionConfigError(error)) {
      return NextResponse.json(
        {
          error:
            "Connections are temporarily unavailable. Please try again in a minute.",
          code: error.code,
        },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status ?? 500 }
    );
  }
}

export async function PATCH(req: Request) {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  try {
    const { id, is_enabled } = await req.json();
    if (!id)
      return NextResponse.json({ error: "id required" }, { status: 400 });
    if (!(await verifyConnectionOwnership(id, userId))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (typeof is_enabled !== "boolean") {
      return NextResponse.json(
        { error: "is_enabled must be a boolean" },
        { status: 400 }
      );
    }
    await updateConnection(id, { is_enabled });
    return NextResponse.json({ ok: true });
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
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  try {
    const { id } = await req.json();
    if (!id)
      return NextResponse.json({ error: "id required" }, { status: 400 });
    if (!(await verifyConnectionOwnership(id, userId))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    await deleteConnection(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

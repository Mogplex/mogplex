import { parseJsonBody } from "@/lib/api/parse-json-body";
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
import { ConnectionValidationError } from "@/lib/connections/validation";

import {
  connectionCreateSchema,
  connectionIdSchema,
  connectionSettingsSchema,
} from "./schema";

const defaultDeps = { requireUserId, db: supabaseAdmin };

export function createConnectionHandlers(
  overrides: Partial<typeof defaultDeps> = {}
) {
  const deps = { ...defaultDeps, ...overrides };
  async function verifyConnectionOwnership(
    connectionId: string,
    userId: string
  ) {
    const { data } = await deps.db
      .from("connections")
      .select("user_id")
      .eq("id", connectionId)
      .single();
    return data?.user_id === userId;
  }

  async function verifyRepoOwnership(repoId: string, userId: string) {
    const { data } = await deps.db
      .from("repos")
      .select("id")
      .eq("id", repoId)
      .eq("user_id", userId)
      .maybeSingle();

    return Boolean(data?.id);
  }

  async function GET() {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    try {
      const connections = await getAllUserConnections(userId);
      return NextResponse.json({ connections });
    } catch (e) {
      return NextResponse.json(
        { error: (e as Error).message },
        { status: 500 }
      );
    }
  }

  async function POST(req: Request) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    try {
      const jsonBody = await parseJsonBody(req);
      if (!jsonBody.ok) return jsonBody.response;
      const parsed = connectionCreateSchema.safeParse(jsonBody.body);
      if (!parsed.success) {
        logConnectionEvent("connection_create_failed", {
          userId,
          reason: "Invalid connection.",
        });
        return NextResponse.json(
          {
            error: "Invalid connection.",
            code: "INVALID_CONNECTION",
            details: parsed.error.flatten(),
          },
          { status: 400 }
        );
      }
      const body = parsed.data;

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

  async function PATCH(req: Request) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    try {
      const jsonBody = await parseJsonBody(req);
      if (!jsonBody.ok) return jsonBody.response;
      const parsedId = connectionIdSchema.safeParse(jsonBody.body);
      if (!parsedId.success) {
        return NextResponse.json(
          { error: "Invalid connection.", details: parsedId.error.flatten() },
          { status: 400 }
        );
      }
      const { id } = parsedId.data;
      if (!(await verifyConnectionOwnership(id, userId))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const parsed = connectionSettingsSchema.safeParse(jsonBody.body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Invalid connection.", details: parsed.error.flatten() },
          { status: 400 }
        );
      }
      await updateConnection(id, parsed.data);
      return NextResponse.json({ ok: true });
    } catch (e) {
      if (e instanceof ConnectionValidationError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
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
      return NextResponse.json(
        { error: (e as Error).message },
        { status: 500 }
      );
    }
  }

  async function DELETE(req: Request) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    try {
      const jsonBody = await parseJsonBody(req);
      if (!jsonBody.ok) return jsonBody.response;
      const parsed = connectionIdSchema.safeParse(jsonBody.body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Invalid connection.", details: parsed.error.flatten() },
          { status: 400 }
        );
      }
      const { id } = parsed.data;
      if (!(await verifyConnectionOwnership(id, userId))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      await deleteConnection(id);
      return NextResponse.json({ ok: true });
    } catch (e) {
      return NextResponse.json(
        { error: (e as Error).message },
        { status: 500 }
      );
    }
  }
  return { GET, POST, PATCH, DELETE };
}

export const { GET, POST, PATCH, DELETE } = createConnectionHandlers();

import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import {
  McpServerValidationError,
  deleteUserMcpServer,
  getUserMcpServerForWeb,
  updateUserMcpServer,
} from "@/lib/mcp-servers";

type McpServerItemDeps = {
  requireUserId: typeof requireUserId;
  getUserMcpServerForWeb: typeof getUserMcpServerForWeb;
  updateUserMcpServer: typeof updateUserMcpServer;
  deleteUserMcpServer: typeof deleteUserMcpServer;
};

const defaultDeps: McpServerItemDeps = {
  requireUserId,
  getUserMcpServerForWeb,
  updateUserMcpServer,
  deleteUserMcpServer,
};

export function createMcpServerGetHandler(
  overrides: Partial<McpServerItemDeps> = {}
) {
  const deps: McpServerItemDeps = {
    ...defaultDeps,
    ...overrides,
  };

  return async function GET(
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
  ) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Invalid server id" }, { status: 400 });
    }

    try {
      const server = await deps.getUserMcpServerForWeb(userId, id);
      if (!server) {
        return NextResponse.json(
          { error: "Server not found" },
          { status: 404 }
        );
      }

      return NextResponse.json({ server });
    } catch (error) {
      return NextResponse.json(
        { error: (error as Error).message },
        { status: 500 }
      );
    }
  };
}

export const GET = createMcpServerGetHandler();

export function createMcpServerPatchHandler(
  overrides: Partial<McpServerItemDeps> = {}
) {
  const deps: McpServerItemDeps = {
    ...defaultDeps,
    ...overrides,
  };

  return async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
  ) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Invalid server id" }, { status: 400 });
    }

    try {
      const server = await deps.updateUserMcpServer(
        userId,
        id,
        await request.json()
      );

      if (!server) {
        return NextResponse.json(
          { error: "Server not found" },
          { status: 404 }
        );
      }

      return NextResponse.json({ server });
    } catch (error) {
      if (error instanceof McpServerValidationError) {
        return NextResponse.json(
          { error: error.message, code: error.code },
          { status: error.status }
        );
      }

      return NextResponse.json(
        { error: (error as Error).message },
        { status: 500 }
      );
    }
  };
}

export const PATCH = createMcpServerPatchHandler();

export function createMcpServerDeleteHandler(
  overrides: Partial<McpServerItemDeps> = {}
) {
  const deps: McpServerItemDeps = {
    ...defaultDeps,
    ...overrides,
  };

  return async function DELETE(
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
  ) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Invalid server id" }, { status: 400 });
    }

    try {
      const deleted = await deps.deleteUserMcpServer(userId, id);
      if (!deleted) {
        return NextResponse.json(
          { error: "Server not found" },
          { status: 404 }
        );
      }

      return NextResponse.json({ ok: true });
    } catch (error) {
      return NextResponse.json(
        { error: (error as Error).message },
        { status: 500 }
      );
    }
  };
}

export const DELETE = createMcpServerDeleteHandler();

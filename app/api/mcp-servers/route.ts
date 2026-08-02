import { NextResponse } from "next/server";
import { getUserId, requireUserId } from "@/lib/auth";
import {
  McpServerValidationError,
  createUserMcpServer,
  listUserMcpServersForCli,
  listUserMcpServersForWeb,
  normalizeMcpServerCreateInput,
} from "@/lib/mcp-servers";
import { listConnectionsForCli } from "@/lib/connections/cli";

type McpServersGetDeps = {
  getUserId: typeof getUserId;
  listUserMcpServersForCli: typeof listUserMcpServersForCli;
  listUserMcpServersForWeb: typeof listUserMcpServersForWeb;
  listConnectionsForCli: typeof listConnectionsForCli;
};

type McpServersPostDeps = {
  requireUserId: typeof requireUserId;
  createUserMcpServer: typeof createUserMcpServer;
};

const defaultGetDeps: McpServersGetDeps = {
  getUserId,
  listUserMcpServersForCli,
  listUserMcpServersForWeb,
  listConnectionsForCli,
};

const defaultPostDeps: McpServersPostDeps = {
  requireUserId,
  createUserMcpServer,
};

function readFormat(request?: Request): "cli" | null {
  if (!request) return null;

  try {
    const url = new URL(request.url);
    return url.searchParams.get("format") === "cli" ? "cli" : null;
  } catch {
    return null;
  }
}

export function createMcpServersGetHandler(
  overrides: Partial<McpServersGetDeps> = {}
) {
  const deps: McpServersGetDeps = {
    ...defaultGetDeps,
    ...overrides,
  };

  return async function GET(request?: Request) {
    const userId = await deps.getUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
      if (readFormat(request) === "cli") {
        const [custom, connections] = await Promise.all([
          deps.listUserMcpServersForCli(userId),
          deps.listConnectionsForCli(userId),
        ]);
        // Custom servers (user_mcp_servers) take precedence on name collision.
        const customNames = new Set(custom.map((s) => s.name));
        const merged = [
          ...custom,
          ...connections.filter((c) => !customNames.has(c.name)),
        ];
        return NextResponse.json(merged);
      }

      return NextResponse.json({
        servers: await deps.listUserMcpServersForWeb(userId),
      });
    } catch (error) {
      return NextResponse.json(
        { error: (error as Error).message },
        { status: 500 }
      );
    }
  };
}

export const GET = createMcpServersGetHandler();

export function createMcpServersPostHandler(
  overrides: Partial<McpServersPostDeps> = {}
) {
  const deps: McpServersPostDeps = {
    ...defaultPostDeps,
    ...overrides,
  };

  return async function POST(request: Request) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    try {
      const body = normalizeMcpServerCreateInput(await request.json());
      const server = await deps.createUserMcpServer(userId, body);
      return NextResponse.json({ server }, { status: 201 });
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

export const POST = createMcpServersPostHandler();

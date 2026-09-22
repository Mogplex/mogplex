import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/lib/auth";
import { testSavedMcpServer } from "@/lib/mcp-servers/diagnostics";

const defaultDeps = { requireUserId };

export function createMcpServerTestHandler(deps = defaultDeps) {
  return async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
  ) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success)
      return NextResponse.json({ error: "Invalid server id" }, { status: 400 });
    const result = await testSavedMcpServer(userId, id, request.signal);
    return NextResponse.json(result ?? { error: "Server not found" }, {
      status: result ? 200 : 404,
      headers: { "Cache-Control": "no-store" },
    });
  };
}

export const POST = createMcpServerTestHandler();

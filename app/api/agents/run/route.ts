import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { MogplexApiRunError, startMogplexApiRun } from "@/lib/mogplex-api/runs";

export type AgentRunRouteDeps = {
  requireUserId: typeof requireUserId;
  startRun: typeof startMogplexApiRun;
};

const defaultDeps: AgentRunRouteDeps = {
  requireUserId,
  startRun: startMogplexApiRun,
};

/**
 * Starts a repository run as a roster agent from the app. Same core as the
 * v1 API and MCP: the session user owns the run, and the run records the
 * agent so the roster can show it.
 */
export function createAgentRunPostHandler(
  overrides: Partial<AgentRunRouteDeps> = {}
) {
  const deps = { ...defaultDeps, ...overrides };
  return async function POST(req: Request) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    const body = (await req.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    if (typeof body.agentId !== "string" || !body.agentId.trim()) {
      return NextResponse.json(
        { error: "agentId is required" },
        { status: 400 }
      );
    }
    const idempotencyKey =
      typeof body.idempotencyKey === "string" && body.idempotencyKey.trim()
        ? body.idempotencyKey.trim().slice(0, 200)
        : `app:${randomUUID()}`;

    try {
      const result = await deps.startRun({
        user: { userId, keyId: "app:agents", scopes: ["runs:write"] },
        idempotencyKey,
        body: {
          repoId: body.repoId,
          prompt: body.prompt,
          harness: body.harness,
          agentId: body.agentId,
          createBranch: body.createBranch ?? true,
          baseBranch: body.baseBranch,
          rootDirectory: body.rootDirectory,
        },
        origin: "app",
      });
      return NextResponse.json(result, { status: result.replayed ? 200 : 201 });
    } catch (error) {
      if (error instanceof MogplexApiRunError) {
        return NextResponse.json(
          { error: error.message },
          { status: error.status }
        );
      }
      console.error("[agents/run] failed to start run", error);
      return NextResponse.json(
        { error: "Failed to start run" },
        { status: 500 }
      );
    }
  };
}

export const POST = createAgentRunPostHandler();

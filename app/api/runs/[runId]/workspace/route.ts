import { requireUserId } from "@/lib/auth";
import { loadRunWorkspace } from "@/lib/run-workspace/context";
import { z } from "zod";

const defaultDeps = { requireUserId, loadContext: loadRunWorkspace };
export function createRunWorkspaceGetHandler(deps = defaultDeps) {
  return async function GET(
    _request: Request,
    { params }: { params: Promise<{ runId: string }> }
  ) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;
    const { runId } = await params;
    if (!z.string().uuid().safeParse(runId).success)
      return Response.json({ error: "Invalid run" }, { status: 400 });
    try {
      const context = await deps.loadContext(userId, runId);
      return context
        ? Response.json(context)
        : Response.json({ error: "Run not found" }, { status: 404 });
    } catch {
      return Response.json(
        { error: "Could not open this run" },
        { status: 500 }
      );
    }
  };
}
export const GET = createRunWorkspaceGetHandler();

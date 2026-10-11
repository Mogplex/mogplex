import { requireUserId } from "@/lib/auth";
import { isUuid } from "@/lib/uuid";
import { ControlRunError, openRunInControl } from "@/lib/control/run-session";

const defaults = { requireUserId, openRun: openRunInControl };
export function createControlRunPostHandler(deps = defaults) {
  return async function POST(
    request: Request,
    { params }: { params: Promise<{ runId: string }> }
  ) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;
    const { runId } = await params;
    if (!isUuid(runId))
      return Response.json({ error: "Invalid run" }, { status: 400 });
    const body = await request.json().catch(() => ({}));
    if (body?.continue !== undefined && typeof body.continue !== "boolean")
      return Response.json({ error: "Invalid action" }, { status: 400 });
    try {
      return Response.json(
        await deps.openRun(userId, runId, body?.continue === true)
      );
    } catch (cause) {
      return Response.json(
        {
          error:
            cause instanceof ControlRunError
              ? cause.message
              : "Could not open this run. Try again.",
        },
        { status: cause instanceof ControlRunError ? cause.status : 500 }
      );
    }
  };
}
export const POST = createControlRunPostHandler();

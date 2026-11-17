import { z } from "zod";
import { requireUserId } from "@/lib/auth";
import { createRunDeliveryStore } from "@/lib/run-delivery/store";
import { refreshRunDelivery } from "@/lib/run-delivery/refresh";

const defaults = {
  requireUserId,
  load: createRunDeliveryStore().load,
  refresh: refreshRunDelivery,
};
export function createRunDeliveryHandler(deps = defaults) {
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
      const run = await deps.load(userId, runId);
      if (!run)
        return Response.json({ error: "Run not found" }, { status: 404 });
      return Response.json({ delivery: await deps.refresh(run, false) });
    } catch {
      console.warn("[run-delivery] Manual refresh failed", { runId });
      return Response.json(
        { error: "Could not refresh delivery status. Try again." },
        { status: 503 }
      );
    }
  };
}
export const GET = createRunDeliveryHandler();

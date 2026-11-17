import { z } from "zod";
import { DeliveryConnectionError } from "@/lib/run-delivery/github";
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
    } catch (error) {
      if (error instanceof DeliveryConnectionError)
        return Response.json({ error: error.message }, { status: 409 });
      console.warn("[run-delivery] Manual refresh failed", { runId });
      return Response.json(
        { error: "Could not refresh delivery status. Try again." },
        { status: 503 }
      );
    }
  };
}
export const GET = createRunDeliveryHandler();

const stopDefaults = {
  requireUserId,
  load: createRunDeliveryStore().load,
  stop: createRunDeliveryStore().stop,
};
export function createStopDeliveryHandler(deps = stopDefaults) {
  return async function DELETE(
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
      if (!(await deps.stop(run)))
        return Response.json(
          {
            error:
              "The agent has resumed. Stop it from run details to cancel the current work.",
          },
          { status: 409 }
        );
      return Response.json({ stopped: true });
    } catch {
      return Response.json(
        { error: "Could not stop follow-ups. Try again." },
        { status: 503 }
      );
    }
  };
}
export const DELETE = createStopDeliveryHandler();

import { requireUserId } from "@/lib/auth";
import { createMogplexApiRunEventsStreamGetHandler } from "@/app/api/v1/mogplex/runs/[runId]/events/stream/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;
export const GET = createMogplexApiRunEventsStreamGetHandler({
  replayFromStart: true,
  resolveUser: async () => {
    const userId = await requireUserId();
    return userId instanceof Response
      ? { ok: false, response: userId }
      : { ok: true, userId };
  },
});

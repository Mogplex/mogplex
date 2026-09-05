import { z } from "zod";
import { requireUserId } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { listControlContinuations } from "@/lib/control/continuation-store";
import { actOnControlContinuation } from "@/lib/control/continuation-actions";
import { controlContinuationSummary } from "@/lib/control/continuation-presentation";

const defaultDeps = { requireUserId, client: supabaseAdmin };
export function createControlContinuationsHandlers(deps = defaultDeps) {
  return {
    async GET(req: Request) {
      const userId = await deps.requireUserId();
      if (userId instanceof Response) return userId;
      const parsed = z
        .string()
        .uuid()
        .safeParse(new URL(req.url).searchParams.get("sessionId"));
      if (!parsed.success)
        return Response.json(
          { error: "A valid mission is required." },
          { status: 400 }
        );
      try {
        const { data, error } = await deps.client
          .from("control_sessions")
          .select("id")
          .eq("id", parsed.data)
          .eq("user_id", userId)
          .maybeSingle();
        if (error) throw error;
        if (!data)
          return Response.json(
            { error: "Mission not found." },
            { status: 404 }
          );
        const tickets = await listControlContinuations(
          userId,
          parsed.data,
          deps.client
        );
        return Response.json({
          continuations: tickets.map(controlContinuationSummary),
        });
      } catch {
        return Response.json(
          { error: "Could not load coordinator follow-ups." },
          { status: 500 }
        );
      }
    },
    async POST(req: Request) {
      const userId = await deps.requireUserId();
      if (userId instanceof Response) return userId;
      const parsed = z
        .object({
          id: z.string().uuid(),
          action: z.enum(["cancel", "retry_delivery"]),
        })
        .safeParse(await req.json().catch(() => null));
      if (!parsed.success)
        return Response.json(
          { error: "Invalid follow-up action." },
          { status: 400 }
        );
      try {
        const result = await actOnControlContinuation(
          userId,
          parsed.data.id,
          parsed.data.action,
          { client: deps.client }
        );
        return Response.json(
          result.error ? { error: result.error } : { ok: true },
          { status: result.status }
        );
      } catch {
        return Response.json(
          {
            error:
              "Could not update the follow-up. Refresh its status before trying again.",
          },
          { status: 500 }
        );
      }
    },
  };
}
export const { GET, POST } = createControlContinuationsHandlers();

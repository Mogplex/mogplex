import { requireUserId } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/uuid";
import { CONTROL_TURN_INTERRUPTED } from "@/lib/control/terminal-outcome";

export const dynamic = "force-dynamic";

const defaultDeps = { requireUserId, client: supabaseAdmin };
export function createControlTurnsHandler(deps = defaultDeps) {
  return async function GET(request: Request) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;
    const sessionId = new URL(request.url).searchParams.get("sessionId");
    if (!sessionId || !isUuid(sessionId))
      return Response.json({ error: "Invalid conversation." }, { status: 400 });
    const { data: session, error } = await deps.client
      .from("control_sessions")
      .select("id,messages")
      .eq("id", sessionId)
      .eq("user_id", userId)
      .eq("archived", false)
      .maybeSingle();
    if (error)
      return Response.json(
        { error: "Could not load the conversation." },
        { status: 500 }
      );
    if (!session)
      return Response.json(
        { error: "Conversation not found." },
        { status: 404 }
      );
    const { data: call, error: callError } = await deps.client
      .from("ai_calls")
      .select("id,status,control_state,metadata")
      .eq("conversation_id", sessionId)
      .eq("user_id", userId)
      .contains("metadata", { surface: "control" })
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (callError)
      return Response.json(
        { error: "Could not load agent status." },
        { status: 500 }
      );
    const messages = (
      session.messages as Array<{
        id: string;
        metadata?: Record<string, unknown>;
      }>
    ).map((message) =>
      message.metadata?.ai_call_id === call?.id ||
      message.id === `control-${call?.id}`
        ? {
            ...message,
            metadata: {
              ...message.metadata,
              workspace_changes: call?.metadata?.workspace_changes,
              workspace_snapshot_error:
                call?.metadata?.workspace_snapshot_error,
            },
          }
        : message
    );
    return Response.json({
      sessionId,
      messages,
      call: call
        ? {
            id: call.id,
            status: call.status,
            error: call.status === "failed" ? CONTROL_TURN_INTERRUPTED : null,
          }
        : null,
    });
  };
}
export const GET = createControlTurnsHandler();

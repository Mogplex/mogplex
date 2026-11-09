import { isToolUIPart, type UIMessage } from "ai";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ControlChatSessionContextError } from "./context";
import type { ControlChatRequestBody } from "./types";

/** Approval is a continuation of the saved execution, not a new composer
 * submission. Never infer its permissions, mode, or sandbox from UI defaults.
 * The execution-history claim still fences the actual approval and tool input.
 */
export async function restoreControlApprovalContext(
  userId: string,
  body: ControlChatRequestBody,
  messages: UIMessage[],
  teamId: string | null,
  client = supabaseAdmin
): Promise<ControlChatRequestBody> {
  const last = messages.at(-1);
  if (
    last?.role !== "assistant" ||
    !last.parts.some(
      (part) => isToolUIPart(part) && part.state === "approval-responded"
    )
  )
    return body;
  if (!body.conversationId)
    throw new ControlChatSessionContextError(
      "Approve actions from a saved Control conversation.",
      409
    );
  const { data: turn, error } = await client
    .from("control_turns")
    .select("ai_call_id,request_context,team_id")
    .eq("user_id", userId)
    .eq("session_id", body.conversationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error)
    throw new ControlChatSessionContextError(
      "Could not load the saved approval context. Try again.",
      500
    );
  if (!turn || (turn.team_id ?? null) !== teamId)
    throw new ControlChatSessionContextError(
      "The saved approval context is unavailable in this workspace.",
      409
    );
  const context = turn.request_context as ControlChatRequestBody;
  if (context.conversationId !== body.conversationId)
    throw new ControlChatSessionContextError(
      "The saved approval conversation changed. Reload before continuing.",
      409
    );
  const { data: call, error: callError } = await client
    .from("ai_calls")
    .select("metadata")
    .eq("id", turn.ai_call_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (callError || !call)
    throw new ControlChatSessionContextError(
      "Could not load the saved approval workspace. Try again.",
      500
    );
  // A tool can create/select the workspace after the initial request was
  // queued. Use its durable execution checkpoint, then revalidate ownership.
  const sandboxId = call.metadata?.sandbox_id;
  return {
    ...context,
    ...(typeof sandboxId === "string" ? { sandboxId } : {}),
    messages: body.messages,
  };
}

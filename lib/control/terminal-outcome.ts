import { supabaseAdmin } from "@/lib/supabase/admin";
import { saveControlTranscript } from "./transcript-store";

export const CONTROL_TURN_INTERRUPTED =
  "The agent stopped before finishing. Your saved work is preserved. Review the last command before continuing; it may have taken effect.";

export async function persistControlTerminalOutcome(
  input: {
    userId: string;
    sessionId: string;
    aiCallId: string;
    cancelled: boolean;
  },
  client = supabaseAdmin
) {
  const { data: session, error } = await client
    .from("control_sessions")
    .select("id,archived")
    .eq("id", input.sessionId)
    .eq("user_id", input.userId)
    .maybeSingle();
  if (error)
    throw new Error("Could not load the stopped Control conversation.");
  if (!session || session.archived) return;
  await saveControlTranscript(
    {
      userId: input.userId,
      sessionId: input.sessionId,
      messages: [
        {
          id: `control-outcome-${input.aiCallId}`,
          role: "assistant",
          metadata: { ai_call_id: input.aiCallId },
          parts: [
            {
              type: "text",
              text: input.cancelled
                ? "The agent was stopped. Your saved work is preserved."
                : CONTROL_TURN_INTERRUPTED,
            },
          ],
        },
      ],
    },
    client
  );
}

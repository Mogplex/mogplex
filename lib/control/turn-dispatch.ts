import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { readActiveTeamIdHeader } from "@/lib/team-capabilities";
import { redactSecretsInValue } from "@/lib/ai-telemetry";
import { createControlAiCall } from "@/app/api/control/chat/_lib/start-call";
import type { executeControlChatRequest } from "@/app/api/control/chat/_lib/execute";
import type { ControlStartupFailure } from "@/app/api/control/chat/_lib/types";
import { saveControlTranscript } from "./transcript-store";
import { validateControlChatMessages } from "@/app/api/control/chat/_lib/messages";
import { TRIGGER_TASK_IDS } from "@/lib/trigger/task-ids";

export async function queueControlTurn(
  input: Parameters<typeof executeControlChatRequest>[0]
) {
  // The session resolver authenticates conversationId and supplies missionId.
  // A client-only mission hint must not bypass the active-turn SQL guard.
  const sessionId = input.body.conversationId;
  if (!sessionId)
    throw new Error("Save this Control conversation before running it.");
  const teamId = readActiveTeamIdHeader(input.req);
  const call = await createControlAiCall(input, teamId, "background");
  try {
    await saveControlTranscript({
      userId: input.userId,
      sessionId,
      messages: await validateControlChatMessages(input.body.messages),
    });
    const { error } = await supabaseAdmin.from("control_turns").insert({
      ai_call_id: call.id,
      user_id: input.userId,
      session_id: sessionId,
      request_context: redactSecretsInValue({
        ...input.body,
        model: input.resolvedModel,
      }),
      team_id: teamId,
      limit_claim_id: input.limitClaimId,
    });
    if (error) throw new Error("Could not save the Control turn.");
    const { tasks } = await import("@trigger.dev/sdk/v3");
    const run = await tasks.trigger(
      TRIGGER_TASK_IDS.controlTurn,
      { userId: input.userId, aiCallId: call.id },
      { idempotencyKey: `control-turn:${call.id}`, maxAttempts: 3 }
    );
    const { error: bindError } = await supabaseAdmin
      .from("control_turns")
      .update({ runtime_run_id: run.id })
      .eq("ai_call_id", call.id)
      .eq("user_id", input.userId)
      .is("claimed_at", null);
    if (bindError) throw new Error("Could not bind the queued Control turn.");
    return {
      completion: null,
      response: createUIMessageStreamResponse({
        stream: createUIMessageStream({
          execute: ({ writer }) => {
            writer.write({
              type: "data-control-turn",
              data: { aiCallId: call.id, sessionId },
              transient: true,
            });
          },
        }),
      }),
    };
  } catch (error) {
    const failure =
      error instanceof Error ? error : new Error("Could not queue Control.");
    (failure as ControlStartupFailure).aiCall = call;
    throw failure;
  }
}

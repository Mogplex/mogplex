import { buildTerminalActivityEntries } from "@/lib/control/activity-stream";
import { projectRunTranscript } from "@/lib/run-workspace/transcript";
import type { AiCallEvent } from "@/lib/types";

/** Normalize native chat and harness events into one recorded command transcript. */
export function agentTerminalEntries(
  callId: string,
  status: string,
  events: AiCallEvent[]
) {
  const transcript = projectRunTranscript(
    callId,
    "",
    events
      .filter((event) => event.ai_call_id === callId)
      .map((event) => ({
        id: event.id,
        type: event.event_type,
        toolName: event.tool_name,
        message: event.message,
        createdAt: event.created_at,
        payload: {
          ...event.payload,
          toolCallId: event.payload.toolCallId ?? event.payload.tool_call_id,
          state:
            event.payload.success === false ? "error" : event.payload.state,
          output: event.payload.error ?? event.payload.output,
        },
      })),
    status
  );
  return buildTerminalActivityEntries(transcript, { fullOutput: true });
}

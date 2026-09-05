import type { UIMessage } from "ai";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { redactSecretsInValue } from "@/lib/ai-telemetry";
import type { ControlSessionRecord } from "./session-types";

export class ControlTranscriptConflictError extends Error {
  constructor() {
    super("The saved conversation changed. Reload it before continuing.");
    this.name = "ControlTranscriptConflictError";
  }
}

/** Append by identity; replacements require the exact previous message. */
export async function saveControlTranscript(
  input: {
    userId: string;
    sessionId: string;
    messages: UIMessage[];
    expectedMessages?: UIMessage[];
  },
  client = supabaseAdmin
): Promise<ControlSessionRecord> {
  const { data, error } = await client.rpc("control_save_messages", {
    p_user_id: input.userId,
    p_session_id: input.sessionId,
    p_messages: redactSecretsInValue(input.messages),
    p_expected_messages: redactSecretsInValue(input.expectedMessages ?? []),
  });
  if (error) throw new Error("Could not save the Control conversation.");
  const result = data as {
    status: "ok" | "conflict" | "not_found";
    session?: ControlSessionRecord;
  } | null;
  if (result?.status === "conflict") throw new ControlTranscriptConflictError();
  if (result?.status !== "ok" || !result.session)
    throw new Error("The Control conversation is no longer available.");
  return result.session;
}

/** Older browser snapshots may add messages, but cannot erase server replies. */
export function mergePersistedControlMessages(
  current: UIMessage[],
  incoming: UIMessage[]
): UIMessage[] {
  const ids = new Set(current.map((message) => message.id));
  return [
    ...current,
    ...incoming.filter((message) => {
      if (ids.has(message.id)) return false;
      ids.add(message.id);
      return true;
    }),
  ];
}

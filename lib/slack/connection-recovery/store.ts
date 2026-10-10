import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SlackEventTaskPayload } from "@/trigger/slack-event-lib/types";
import type { ConnectionRecoveryTarget } from "./presentation";

export type ConnectionRecoveryRequest = {
  id: string;
  request_key: string;
  user_id: string;
  slack_installation_id: string;
  target: ConnectionRecoveryTarget;
  payload: SlackEventTaskPayload;
  resume_text: string;
  product_team_id: string | null;
  repo_id: string | null;
  dispatched_at: string | null;
};

type Client = Pick<typeof supabaseAdmin, "from">;

export async function saveConnectionRecoveryRequest(
  input: Omit<
    ConnectionRecoveryRequest,
    "id" | "request_key" | "dispatched_at"
  >,
  db: Client = supabaseAdmin
): Promise<ConnectionRecoveryRequest> {
  const requestKey = createHash("sha256")
    .update(
      JSON.stringify([
        input.user_id,
        input.slack_installation_id,
        input.payload.eventId,
        input.target,
        input.resume_text,
        input.product_team_id,
        input.repo_id,
      ])
    )
    .digest("hex");
  const { error } = await db.from("slack_connection_requests").upsert(
    {
      ...input,
      request_key: requestKey,
    },
    { onConflict: "request_key", ignoreDuplicates: true }
  );
  if (error) throw new Error("Could not save the connection request");
  const { data, error: readError } = await db
    .from("slack_connection_requests")
    .select("*")
    .eq("request_key", requestKey)
    .eq("user_id", input.user_id)
    .single();
  if (readError || !data)
    throw new Error("Could not load the connection request");
  return data as ConnectionRecoveryRequest;
}

export async function loadConnectionRecoveryRequest(
  id: string,
  userId: string,
  db: Client = supabaseAdmin
) {
  const { data, error } = await db
    .from("slack_connection_requests")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error("Could not load the connection request");
  return data as ConnectionRecoveryRequest | null;
}

export async function markConnectionRecoveryDispatched(
  id: string,
  userId: string,
  db: Client = supabaseAdmin
) {
  const { error } = await db
    .from("slack_connection_requests")
    .update({ dispatched_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId)
    .is("dispatched_at", null);
  if (error) throw new Error("Could not save the connection continuation");
}

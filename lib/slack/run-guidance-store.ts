import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { ExternalAgentRunRow } from "@/lib/mogplex-api/runs-types";
import type { SlackRunImageAttachmentsMetadata } from "./run-attachments";

export type GuidanceThread = {
  userId: string;
  teamId: string;
  channelId: string;
  threadTs: string;
  slackUserId: string;
  eventId?: string;
};
const receiptSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["received", "delivered", "not_applied"]),
});
const guidanceSchema = receiptSchema.extend({
  run_id: z.string().uuid(),
  user_id: z.string().uuid(),
  ai_call_id: z.string().uuid(),
  body: z.string(),
  attachments: z.unknown(),
  created_at: z
    .union([z.string(), z.date()])
    .transform((value) =>
      typeof value === "string" ? value : value.toISOString()
    ),
  delivered_step: z.number().int().nullable(),
  // The agent's recorded answer; absent on rows read before replies existed.
  reply_text: z.string().nullable().optional(),
});
export type RunGuidance = z.infer<typeof guidanceSchema>;

/** Only this sender's exact thread can steer a run; never guess a DM's latest run. */
export async function findSlackGuidanceRuns(
  input: GuidanceThread,
  client: Pick<SupabaseClient, "from"> = supabaseAdmin
): Promise<ExternalAgentRunRow[]> {
  // A webhook retry belongs to the run that accepted it, even after that run
  // stops. Otherwise the event could fall through to launching a new task.
  if (input.eventId) {
    const { data: receipt, error } = await client
      .from("slack_run_guidance")
      .select("run_id")
      .eq("user_id", input.userId)
      .eq("slack_team_id", input.teamId)
      .eq("slack_user_id", input.slackUserId)
      .eq("channel_id", input.channelId)
      .eq("thread_ts", input.threadTs)
      .eq("event_id", input.eventId)
      .maybeSingle();
    if (error) throw new Error("Could not resolve guidance receipt");
    if (receipt) {
      const { data: run, error: runError } = await client
        .from("external_agent_runs")
        .select("*")
        .eq("user_id", input.userId)
        .eq("id", z.string().uuid().parse(receipt.run_id))
        .maybeSingle();
      if (runError || !run) throw new Error("Could not resolve guidance run");
      return [run as ExternalAgentRunRow];
    }
  }
  return findSlackThreadRuns(input, client, [
    "pending",
    "streaming",
    "awaiting_input",
  ]);
}

/** Resolve only runs owned by this sender in this exact Slack thread. */
export async function findSlackThreadRuns(
  input: GuidanceThread,
  client: Pick<SupabaseClient, "from"> = supabaseAdmin,
  statuses?: ExternalAgentRunRow["status"][]
): Promise<ExternalAgentRunRow[]> {
  const base = () => {
    const query = client
      .from("external_agent_runs")
      .select("*")
      .eq("user_id", input.userId)
      .eq("metadata->>slack_user_id", input.slackUserId);
    return statuses ? query.in("status", statuses) : query;
  };
  const results = await Promise.all([
    base()
      .contains("metadata", {
        slackRunControls: { teamId: input.teamId, channelId: input.channelId },
      })
      .eq("metadata->>slack_thread_ts", input.threadTs)
      .limit(2),
    base()
      .contains("metadata", {
        slackRunControls: {
          teamId: input.teamId,
          channelId: input.channelId,
          messageTs: input.threadTs,
        },
      })
      .limit(2),
  ]);
  if (results.some((result) => result.error))
    throw new Error("Could not resolve the run thread");
  return [
    ...new Map(
      results
        .flatMap((result) => (result.data ?? []) as ExternalAgentRunRow[])
        .map((row) => [row.id, row])
    ).values(),
  ];
}

export async function submitSlackRunGuidance(
  input: GuidanceThread & {
    runId: string;
    aiCallId: string;
    eventId: string;
    messageTs: string;
    body: string;
    attachments: SlackRunImageAttachmentsMetadata | null;
  },
  client: Pick<SupabaseClient, "rpc"> = supabaseAdmin
) {
  const { data, error } = await client.rpc("submit_slack_run_guidance", {
    p_run_id: input.runId,
    p_user_id: input.userId,
    p_ai_call_id: input.aiCallId,
    p_team_id: input.teamId,
    p_channel_id: input.channelId,
    p_thread_ts: input.threadTs,
    p_slack_user_id: input.slackUserId,
    p_event_id: input.eventId,
    p_message_ts: input.messageTs,
    p_body: input.body,
    p_attachments: input.attachments,
  });
  if (error) throw new Error("Could not save your guidance");
  return data === null ? null : receiptSchema.parse(data);
}

/** Owner guidance typed in Mogplex for a native run with no Slack thread. */
export async function submitWorkspaceRunGuidance(
  input: {
    userId: string;
    runId: string;
    aiCallId: string;
    eventId: string;
    body: string;
  },
  client: Pick<SupabaseClient, "rpc"> = supabaseAdmin
) {
  const { data, error } = await client.rpc("submit_run_guidance", {
    p_run_id: input.runId,
    p_user_id: input.userId,
    p_ai_call_id: input.aiCallId,
    p_event_id: input.eventId,
    p_body: input.body,
  });
  if (error) throw new Error("Could not save your guidance");
  return data === null ? null : receiptSchema.parse(data);
}

export async function loadRunGuidance(
  run: Pick<ExternalAgentRunRow, "id" | "user_id" | "ai_call_id">,
  client: Pick<SupabaseClient, "from"> = supabaseAdmin,
  allSegments = false
) {
  let query = client
    .from("slack_run_guidance")
    .select(
      "id,run_id,user_id,ai_call_id,body,attachments,status,delivered_step,created_at,reply_text"
    )
    .eq("run_id", run.id)
    .eq("user_id", run.user_id);
  if (!allSegments) query = query.eq("ai_call_id", run.ai_call_id);
  const { data, error } = await query
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw new Error("Could not load run guidance");
  return z.array(guidanceSchema).parse(data ?? []);
}

export function loadRunGuidanceReceipts(
  run: Pick<ExternalAgentRunRow, "id" | "user_id" | "ai_call_id">
) {
  return loadRunGuidance(run, supabaseAdmin, true);
}

export async function deliverRunGuidance(
  input: {
    runId: string;
    userId: string;
    aiCallId: string;
    ids: string[];
    step: number;
  },
  client: Pick<SupabaseClient, "rpc"> = supabaseAdmin
): Promise<number> {
  if (input.ids.length === 0) return 0;
  const { data, error } = await client.rpc("deliver_slack_run_guidance", {
    p_run_id: input.runId,
    p_user_id: input.userId,
    p_ai_call_id: input.aiCallId,
    p_guidance_ids: input.ids,
    p_step: input.step,
  });
  if (error) throw new Error("Could not record guidance receipt");
  return z.number().int().nonnegative().parse(Number(data));
}

/**
 * Attach the agent's first answer after guidance reached it. Only delivered
 * rows without a reply are touched, so a later step never overwrites it.
 */
export async function recordRunGuidanceReply(
  input: {
    runId: string;
    userId: string;
    aiCallId: string;
    ids: string[];
    text: string;
  },
  client: Pick<SupabaseClient, "from"> = supabaseAdmin
): Promise<number> {
  if (input.ids.length === 0 || !input.text.trim()) return 0;
  const { data, error } = await client
    .from("slack_run_guidance")
    .update({ reply_text: input.text, updated_at: new Date().toISOString() })
    .eq("run_id", input.runId)
    .eq("user_id", input.userId)
    .eq("ai_call_id", input.aiCallId)
    .eq("status", "delivered")
    .in("id", input.ids)
    .is("reply_text", null)
    .select("id");
  if (error) throw new Error("Could not record the agent's reply");
  return (data ?? []).length;
}

const pendingReplySchema = z.object({
  id: z.string().uuid(),
  channel_id: z.string(),
  thread_ts: z.string(),
  reply_text: z.string(),
});
export type PendingGuidanceReply = z.infer<typeof pendingReplySchema>;

/** Slack-thread replies the delivery task has not posted yet, oldest first. */
export async function loadPendingGuidanceReplies(
  run: Pick<ExternalAgentRunRow, "id" | "user_id">,
  client: Pick<SupabaseClient, "from"> = supabaseAdmin
): Promise<PendingGuidanceReply[]> {
  const { data, error } = await client
    .from("slack_run_guidance")
    .select("id,channel_id,thread_ts,reply_text")
    .eq("run_id", run.id)
    .eq("user_id", run.user_id)
    .not("reply_text", "is", null)
    .is("reply_posted_ts", null)
    .not("thread_ts", "is", null)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw new Error("Could not load guidance replies");
  return z.array(pendingReplySchema).parse(data ?? []);
}

export async function markGuidanceReplyPosted(
  input: { id: string; userId: string; messageTs: string },
  client: Pick<SupabaseClient, "from"> = supabaseAdmin
) {
  const { error } = await client
    .from("slack_run_guidance")
    .update({ reply_posted_ts: input.messageTs })
    .eq("id", input.id)
    .eq("user_id", input.userId)
    .is("reply_posted_ts", null);
  if (error) throw new Error("Could not record the posted reply");
}

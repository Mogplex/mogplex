import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RunProgressState } from "./run-progress-state";
import { progressText } from "./run-progress-state";
import type { ExternalAgentRunRow } from "@/lib/mogplex-api/runs-types";

const snapshotSchema = z.object({
  phase: z.string(),
  summary: z.string(),
  next: z.string(),
  lastActivityAt: z.number().finite().nonnegative().max(8_640_000_000_000_000),
  sequence: z.number().int().nonnegative(),
  tasks: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string(),
      title: z.string(),
      status: z.enum(["in_progress", "complete", "error"]),
      startedAt: z.number().finite(),
      finishedAt: z.number().finite().optional(),
      result: z.string().optional(),
    })
  ),
});

export function serializeRunProgress(state: RunProgressState) {
  const { textBuffer: _buffer, tasks, ...fields } = state;
  return { ...fields, tasks: [...tasks.values()] };
}

export function readRunProgressSnapshot(
  value: unknown
): RunProgressState | null {
  const result = snapshotSchema.safeParse(value);
  if (!result.success) return null;
  const snapshot = result.data;
  return {
    ...snapshot,
    phase: progressText(snapshot.phase, 80),
    summary: progressText(snapshot.summary),
    next: progressText(snapshot.next, 200),
    textBuffer: "",
    tasks: new Map(
      snapshot.tasks.map((task) => [
        task.id,
        {
          ...task,
          title: progressText(task.title, 200),
          result: task.result ? progressText(task.result) : undefined,
        },
      ])
    ),
  };
}

export async function publishRunProgress(
  input: {
    runId: string;
    userId: string;
    aiCallId: string;
    state: RunProgressState;
  },
  client: Pick<SupabaseClient, "rpc"> = supabaseAdmin
): Promise<number | null> {
  const { data, error } = await client.rpc("publish_slack_run_progress", {
    p_run_id: input.runId,
    p_user_id: input.userId,
    p_ai_call_id: input.aiCallId,
    p_progress: serializeRunProgress(input.state),
  });
  if (error) throw new Error("Could not save run progress");
  return data === null
    ? null
    : z.number().int().nonnegative().parse(Number(data));
}

export async function markRunProgressDelivered(
  run: ExternalAgentRunRow,
  key: string,
  client: Pick<SupabaseClient, "from"> = supabaseAdmin
) {
  const { error } = await client
    .from("external_agent_runs")
    .update({
      slack_progress_delivered_key: key,
      slack_progress_delivered_at: new Date().toISOString(),
    })
    .eq("id", run.id)
    .eq("user_id", run.user_id)
    .eq("ai_call_id", run.ai_call_id)
    .eq("status", run.status);
  if (error) throw new Error("Could not record Slack delivery");
}

import type { SupabaseClient } from "@supabase/supabase-js";
import type { SlackToolExecutionDatabase } from "@/lib/agents/slack-tool-idempotency";

export const SLACK_TOOL_EXECUTION_RETENTION_MS = 24 * 60 * 60 * 1000;
export const SLACK_TOOL_EXECUTION_RETENTION_BATCH_SIZE = 500;
export const SLACK_TOOL_EXECUTION_RETENTION_MAX_BATCHES = 100;

type SlackToolRetentionClient = Pick<
  SupabaseClient<SlackToolExecutionDatabase>,
  "from"
>;

async function getSupabaseAdmin(): Promise<SlackToolRetentionClient> {
  return (await import("@/lib/supabase/admin"))
    .supabaseAdmin as unknown as SlackToolRetentionClient;
}

async function selectExpiredSlackToolExecutionIds(input: {
  client: SlackToolRetentionClient;
  cutoff: string;
  batchSize: number;
}) {
  const { data, error } = await input.client
    .from("slack_tool_executions")
    .select("id")
    .lt("started_at", input.cutoff)
    .order("started_at", { ascending: true })
    .limit(input.batchSize);

  if (error) {
    throw new Error(
      `Failed to select expired Slack tool executions: ${error.message}`
    );
  }

  return (data ?? []).map((row) => row.id);
}

async function deleteSlackToolExecutionBatch(input: {
  client: SlackToolRetentionClient;
  ids: string[];
}) {
  const { count, error } = await input.client
    .from("slack_tool_executions")
    .delete({ count: "exact" })
    .in("id", input.ids);

  if (error) {
    throw new Error(
      `Failed to delete expired Slack tool executions: ${error.message}`
    );
  }

  return count ?? 0;
}

export async function deleteExpiredSlackToolExecutions(
  input: {
    client?: SlackToolRetentionClient;
    now?: Date;
    batchSize?: number;
    maxBatches?: number;
  } = {}
) {
  const client = input.client ?? (await getSupabaseAdmin());
  const now = input.now ?? new Date();
  const batchSize =
    input.batchSize ?? SLACK_TOOL_EXECUTION_RETENTION_BATCH_SIZE;
  const maxBatches =
    input.maxBatches ?? SLACK_TOOL_EXECUTION_RETENTION_MAX_BATCHES;
  const cutoff = new Date(
    now.getTime() - SLACK_TOOL_EXECUTION_RETENTION_MS
  ).toISOString();
  let deleted = 0;

  for (let batch = 0; batch < maxBatches; batch += 1) {
    const ids = await selectExpiredSlackToolExecutionIds({
      client,
      cutoff,
      batchSize,
    });
    if (ids.length === 0) {
      return { cutoff, deleted, batches: batch, hasMore: false };
    }

    deleted += await deleteSlackToolExecutionBatch({ client, ids });
    if (ids.length < batchSize) {
      return { cutoff, deleted, batches: batch + 1, hasMore: false };
    }
  }

  return { cutoff, deleted, batches: maxBatches, hasMore: true };
}

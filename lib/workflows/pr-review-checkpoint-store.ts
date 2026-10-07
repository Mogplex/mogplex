import { modelMessageSchema } from "ai";
import { z } from "zod/v4";
import { supabaseAdmin } from "@/lib/supabase/admin";

const checkpointSchema = z.object({
  version: z.literal(1),
  messages: z.array(modelMessageSchema),
  steps: z.array(
    z.object({
      toolCalls: z
        .array(
          z.object({
            toolName: z.string(),
            input: z.unknown(),
            invalid: z.boolean().optional(),
          })
        )
        .optional(),
      toolResults: z.array(z.unknown()).optional(),
    })
  ),
  text: z.string(),
  complete: z.boolean(),
  inFlightTool: z.string().nullable(),
});

export type PrReviewCheckpoint = z.infer<typeof checkpointSchema>;
export type PrReviewCheckpointScope = {
  jobRunId: string;
  nodeId: string;
  userId: string;
  fingerprint: string;
};
export type PrReviewCheckpointStore = {
  load: (scope: PrReviewCheckpointScope) => Promise<PrReviewCheckpoint | null>;
  save: (
    scope: PrReviewCheckpointScope,
    checkpoint: PrReviewCheckpoint
  ) => Promise<void>;
};

export function createPrReviewCheckpointStore(
  client = supabaseAdmin
): PrReviewCheckpointStore {
  async function read(scope: PrReviewCheckpointScope, jobRunId: string) {
    const { data, error } = await client
      .from("pr_review_checkpoints")
      .select("fingerprint,checkpoint")
      .eq("job_run_id", jobRunId)
      .eq("node_id", scope.nodeId)
      .eq("user_id", scope.userId)
      .maybeSingle();
    if (error)
      throw new Error("Could not read saved review progress", { cause: error });
    if (!data) return null;
    const checkpoint = checkpointSchema.parse(data.checkpoint);
    // Changing the model or instructions must not hide an unknown action
    // outcome on the run being retried.
    return checkpoint.inFlightTool || data.fingerprint === scope.fingerprint
      ? checkpoint
      : null;
  }
  return {
    async load(scope) {
      // Follow the server-owned retry relation, never a caller-supplied source id.
      // An intermediate retry may fail in setup before it writes a checkpoint.
      const visited = new Set<string>();
      let jobRunId: string | null = scope.jobRunId;
      while (jobRunId) {
        if (visited.has(jobRunId))
          throw new Error("Invalid review retry chain");
        visited.add(jobRunId);
        const checkpoint = await read(scope, jobRunId);
        if (checkpoint) return checkpoint;
        const {
          data,
          error,
        }: {
          data: { retry_of_job_run_id: unknown } | null;
          error: unknown;
        } = await client
          .from("job_runs")
          .select("retry_of_job_run_id")
          .eq("id", jobRunId)
          .maybeSingle();
        if (error)
          throw new Error("Could not read review retry source", {
            cause: error,
          });
        jobRunId =
          typeof data?.retry_of_job_run_id === "string"
            ? data.retry_of_job_run_id
            : null;
      }
      return null;
    },
    async save(scope, checkpoint) {
      const { error } = await client.from("pr_review_checkpoints").upsert(
        {
          job_run_id: scope.jobRunId,
          node_id: scope.nodeId,
          user_id: scope.userId,
          fingerprint: scope.fingerprint,
          checkpoint: checkpointSchema.parse(checkpoint),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "job_run_id,node_id" }
      );
      if (error)
        throw new Error("Could not save review progress", { cause: error });
    },
  };
}

export const prReviewCheckpointStore = createPrReviewCheckpointStore();

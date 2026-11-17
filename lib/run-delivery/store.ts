import { getNeonPool } from "@/lib/db/pool";
import type { ExternalAgentRunRow } from "@/lib/mogplex-api/runs-types";
import type { DeliverySnapshot } from "./types";

export type DeliveryRun = ExternalAgentRunRow & { repo_full_name: string };
type Query = (
  sql: string,
  values: unknown[]
) => Promise<{ rows: DeliveryRun[] }>;

export function createRunDeliveryStore(
  query: Query = (sql, values) => getNeonPool().query(sql, values)
) {
  return {
    async load(userId: string, runId: string): Promise<DeliveryRun | null> {
      const result = await query(
        `SELECT run.*, repo.full_name AS repo_full_name FROM external_agent_runs run JOIN repos repo ON repo.id = run.repo_id WHERE run.id = $1 AND run.user_id = $2`,
        [runId, userId]
      );
      return result.rows[0] ?? null;
    },
    async listForRepos(
      repoIds: string[],
      match: { shas: string[]; branches: string[] }
    ) {
      if (
        repoIds.length === 0 ||
        (match.shas.length === 0 && match.branches.length === 0)
      )
        return [];
      const result = await query(
        `SELECT run.*, repo.full_name AS repo_full_name FROM external_agent_runs run JOIN repos repo ON repo.id = run.repo_id WHERE run.repo_id = ANY($1::uuid[]) AND run.metadata->>'delivery_follow_through' = 'true' AND run.status IN ('success', 'streaming') AND (run.metadata->>'delivery_pull_request_number' IS NOT NULL OR run.working_branch <> run.base_branch) AND (run.working_branch = ANY($2::text[]) OR run.metadata->'delivery_progress'->'pullRequest'->>'headSha' = ANY($3::text[]) OR run.metadata->'delivery_progress'->'pullRequest'->>'mergeSha' = ANY($3::text[]))`,
        [repoIds, match.branches, match.shas]
      );
      return result.rows;
    },
    async authorize(
      run: ExternalAgentRunRow
    ): Promise<ExternalAgentRunRow | null> {
      const result = await query(
        `UPDATE external_agent_runs SET metadata = (coalesce(metadata, '{}'::jsonb) - 'delivery_progress' - 'delivery_last_repair_revision') || jsonb_build_object('delivery_follow_through', true, 'delivery_authorized_at', now()), updated_at = now() WHERE id = $1 AND user_id = $2 AND ai_call_id = $3 AND status = 'awaiting_input' AND metadata->>'checkpoint_kind' = 'review' RETURNING *`,
        [run.id, run.user_id, run.ai_call_id]
      );
      return result.rows[0] ?? null;
    },
    async save(
      run: ExternalAgentRunRow,
      snapshot: DeliverySnapshot
    ): Promise<ExternalAgentRunRow | null> {
      const result = await query(
        `UPDATE external_agent_runs SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('delivery_progress', $4::jsonb) || CASE WHEN metadata->>'delivery_follow_through' IS DISTINCT FROM 'true' OR metadata->>'delivery_pull_request_number' IS NOT NULL OR $6::integer IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('delivery_pull_request_number', $6::integer) END || CASE WHEN $4::jsonb->'pullRequest'->>'state' = 'closed' OR ($4::jsonb->'pullRequest'->>'state' = 'merged' AND $4::jsonb->'deployment'->>'state' IN ('success','inactive')) THEN '{"delivery_follow_through":false}'::jsonb ELSE '{}'::jsonb END, updated_at = now() WHERE id = $1 AND user_id = $2 AND ai_call_id = $3 AND coalesce(metadata->'delivery_progress'->>'observedAt', '') < $5 AND (metadata->>'delivery_pull_request_number' IS NULL OR $6::integer IS NULL OR metadata->>'delivery_pull_request_number' = $6::text) RETURNING *`,
        [
          run.id,
          run.user_id,
          run.ai_call_id,
          JSON.stringify(snapshot),
          snapshot.observedAt,
          snapshot.pullRequest?.number ?? null,
        ]
      );
      return result.rows[0] ?? null;
    },
    async stop(run: ExternalAgentRunRow): Promise<ExternalAgentRunRow | null> {
      const result = await query(
        `UPDATE external_agent_runs SET metadata = coalesce(metadata, '{}'::jsonb) || '{"delivery_follow_through":false}'::jsonb, updated_at = now() WHERE id = $1 AND user_id = $2 AND ai_call_id = $3 AND status = 'success' RETURNING *`,
        [run.id, run.user_id, run.ai_call_id]
      );
      return result.rows[0] ?? null;
    },
    async claimCheckpoint(input: {
      run: ExternalAgentRunRow;
      aiCallId: string;
      runtimeRunId: string;
    }): Promise<ExternalAgentRunRow | null> {
      const { run } = input;
      const result = await query(
        `UPDATE external_agent_runs SET ai_call_id = $4, runtime_provider = 'trigger', runtime_run_id = $5, status = 'streaming', error = null, updated_at = now() WHERE id = $1 AND user_id = $2 AND ai_call_id = $3 AND status = 'awaiting_input' RETURNING *`,
        [
          run.id,
          run.user_id,
          run.ai_call_id,
          input.aiCallId,
          input.runtimeRunId,
        ]
      );
      return result.rows[0] ?? null;
    },
    async claimRepair(input: {
      run: ExternalAgentRunRow;
      revision: string;
      headSha: string;
      aiCallId: string;
      runtimeRunId: string;
    }): Promise<ExternalAgentRunRow | null> {
      const { run } = input;
      const result = await query(
        `UPDATE external_agent_runs SET ai_call_id = $4, runtime_provider = 'trigger', runtime_run_id = $5, status = 'streaming', error = null, metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('delivery_last_repair_revision', $6::text), updated_at = now() WHERE id = $1 AND user_id = $2 AND ai_call_id = $3 AND status = 'success' AND metadata->>'delivery_follow_through' = 'true' AND metadata->'delivery_progress'->>'repairRevision' = $6 AND metadata->'delivery_progress'->'pullRequest'->>'headSha' = $7 AND metadata->'delivery_progress'->'pullRequest'->>'state' = 'open' AND coalesce(metadata->>'delivery_last_repair_revision', '') <> $6 RETURNING *`,
        [
          run.id,
          run.user_id,
          run.ai_call_id,
          input.aiCallId,
          input.runtimeRunId,
          input.revision,
          input.headSha,
        ]
      );
      return result.rows[0] ?? null;
    },
  };
}

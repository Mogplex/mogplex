import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { createPostgrestShim } from "@/lib/db/postgrest-shim";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { tryLogAiCall } from "@/lib/workflows/automation-job-persistence";
import { createTestDb, MODELS, seedModels } from "./harness";

it("persists scheduled Flow usage and rolls its priced cost into the job", async () => {
  const pg = await createTestDb();
  const previousFrom = Object.getOwnPropertyDescriptor(supabaseAdmin, "from");
  try {
    await seedModels(pg);
    await pg.exec(`
      alter table ai_calls
        add column user_id uuid,
        add column type text,
        add column duration_ms integer,
        add column status text,
        add column error text,
        add column repo_id uuid,
        add column tool_calls_count integer,
        add column tool_calls jsonb,
        add column metadata jsonb,
        add column gateway_generation_ids text[];
    `);
    await pg.exec(
      await readFile(
        new URL(
          "../../neon/migrations/20260912191000_dependabot_alert_ai_calls.sql",
          import.meta.url
        ),
        "utf8"
      )
    );
    const jobRunId = "00000000-0000-4000-8000-000000000001";
    await pg.query("insert into job_runs(id) values ($1)", [jobRunId]);
    const shim = createPostgrestShim({
      query: async (sql, values) => {
        const result = await pg.query(sql, values);
        return { rows: result.rows as Record<string, unknown>[] };
      },
    });
    Object.defineProperty(supabaseAdmin, "from", {
      configurable: true,
      value: shim.from.bind(shim),
    });
    const error = await tryLogAiCall({
      context: {
        assignmentType: "schedule",
        skillId: null,
        agent: { model: MODELS.sonnet.id, system_prompt: null },
        repo: {
          id: "00000000-0000-4000-8000-000000000002",
          user_id: "00000000-0000-4000-8000-000000000003",
          full_name: "acme/widgets",
        },
        metadata: { source_type: "schedule", flow_node_id: "analysis" },
      },
      jobRunId,
      status: "success",
      startedAt: new Date().toISOString(),
      durationMs: 1000,
      inputTokens: 1000,
      outputTokens: 500,
    });
    expect(error).toBeNull();
    const calls = await pg.query<{
      type: string;
      input_tokens: number;
      output_tokens: number;
      cost_usd: string;
      metadata: Record<string, unknown>;
    }>("select * from ai_calls where job_run_id=$1", [jobRunId]);
    expect(calls.rows).toHaveLength(1);
    expect(calls.rows[0]).toMatchObject({
      type: "cron",
      input_tokens: 1000,
      output_tokens: 500,
      metadata: { source_type: "schedule", flow_node_id: "analysis" },
    });
    expect(Number(calls.rows[0].cost_usd)).toBeCloseTo(0.0105);
    const jobs = await pg.query<{ cost_usd: string }>(
      "select cost_usd from job_runs where id=$1",
      [jobRunId]
    );
    expect(Number(jobs.rows[0].cost_usd)).toBeCloseTo(0.0105);
  } finally {
    if (previousFrom)
      Object.defineProperty(supabaseAdmin, "from", previousFrom);
    else Reflect.deleteProperty(supabaseAdmin, "from");
    await pg.close();
  }
});

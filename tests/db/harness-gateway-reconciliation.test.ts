import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createTestDb } from "./harness";
import { createPostgrestShim } from "@/lib/db/postgrest-shim";
import { runAiCallCostReconciliation } from "../../trigger/reconcile-ai-call-costs";

it("discovers tagged calls without generation IDs and claims each cost once under the real gateway guard", async () => {
  const db = await createTestDb();
  try {
    await db.exec(
      `alter table ai_calls add column user_id uuid, add column metadata jsonb, add column gateway_generation_ids text[];`
    );
    const id = randomUUID();
    const owner = randomUUID();
    const marker = {
      gateway_cost_tracking: "report-v1",
      ai_billing_source: "platform_ai_gateway",
    };
    await db.query(
      `insert into ai_calls(id,user_id,model,started_at,completed_at,metadata) values ($1,$2,'harness:codex','2026-05-16T09:00:00Z','2026-05-16T10:00:00Z',$3)`,
      [id, owner, JSON.stringify(marker)]
    );
    // Historical, untagged costs must not become retroactive debits.
    await db.query(
      `insert into ai_calls(user_id,model,started_at,completed_at) values ($1,'harness:codex','2026-05-16T09:00:00Z','2026-05-16T10:00:00Z')`,
      [owner]
    );
    const client = createPostgrestShim({
      query: async (sql, values) => ({
        rows: (await db.query(sql, values)).rows as Record<string, unknown>[],
      }),
    });
    const debits: number[] = [];
    const deps = {
      supabase: client as never,
      now: () => new Date("2026-05-16T11:00:00Z"),
      gateway: {
        getGenerationInfo: async () => {
          throw new Error("A report must not invent a generation ID");
        },
        getSpendReport: async ({ tags }: { tags?: string[] }) => {
          expect(tags).toEqual([`ai-call:${id}`]);
          return { results: [{ totalCost: 0.4, requestCount: 3 }] };
        },
      },
      meterReconciledTokenUsage: async ({ costUsd }: { costUsd: number }) => {
        debits.push(costUsd);
        return {
          metered: true,
          reason: "posted" as const,
          amountCents: 40,
          costUnits: 40_000_000,
        };
      },
      sentry: {
        captureMessage: () => {},
        captureException: (error: unknown) => {
          throw error;
        },
      },
    };
    expect(await runAiCallCostReconciliation(deps)).toEqual({
      scanned: 1,
      reconciled: 1,
      skipped: 0,
      errored: 0,
    });
    expect(await runAiCallCostReconciliation(deps)).toEqual({
      scanned: 0,
      reconciled: 0,
      skipped: 0,
      errored: 0,
    });
    expect(debits).toEqual([0.4]);
    const saved = (
      await db.query<{
        cost_usd: string;
        cost_source: string;
        gateway_generation_id: string | null;
      }>(
        "select cost_usd,cost_source,gateway_generation_id from ai_calls where id=$1",
        [id]
      )
    ).rows[0];
    expect(Number(saved.cost_usd)).toBe(0.4);
    expect(saved.cost_source).toBe("gateway");
    expect(saved.gateway_generation_id).toBeNull();
  } finally {
    await db.close();
  }
});

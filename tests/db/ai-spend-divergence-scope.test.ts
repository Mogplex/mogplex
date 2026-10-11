import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { createTestDb } from "./harness";
import { createPostgrestShim } from "@/lib/db/postgrest-shim";
import { runAiSpendDivergenceCheck } from "../../trigger/ai-spend-divergence-check";

it("compares the real ai_calls UTC sum with Gateway run spend and retains unknown costs", async () => {
  const db = await createTestDb();
  try {
    await db.exec("create role service_role;");
    await db.exec(
      await readFile(
        new URL(
          "../../supabase/migrations/20260623120000_sum_ai_call_costs.sql",
          import.meta.url
        ),
        "utf8"
      )
    );
    await db.exec(`insert into ai_calls(model,cost_usd,cost_source,gateway_generation_id,completed_at) values
      ('generic/model',70,'gateway','gen_current','2026-05-15T12:00:00Z'),
      ('generic/model',9,'gateway','gen_previous','2026-05-14T12:00:00Z');`);
    const client = createPostgrestShim({
      query: async (sql, values) => ({
        rows: (await db.query(sql, values)).rows as Record<string, unknown>[],
      }),
    });
    const warnings: unknown[] = [];
    for (const totalCost of [120, 126]) {
      const summary = await runAiSpendDivergenceCheck({
        supabase: client as never,
        now: () => new Date("2026-05-16T12:00:00Z"),
        gateway: {
          getSpendReport: async (params) => ({
            results: [{ totalCost: params.tags ? 50 : totalCost }],
          }),
        },
        sentry: {
          captureMessage: (_message, context) => {
            warnings.push(context);
          },
        },
      });
      expect(summary.localTotal).toBe(70);
      expect(summary.internalOverheadTotal).toBe(50);
      expect(summary.divergent).toBe(totalCost === 126);
    }
    expect(warnings).toHaveLength(1);
  } finally {
    await db.close();
  }
});

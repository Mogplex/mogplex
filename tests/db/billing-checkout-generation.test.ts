import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgrestShim, type Queryable } from "@/lib/db/postgrest-shim";
import { advanceSubscriptionCheckoutGeneration } from "@/lib/billing/accounts";
import {
  ACCOUNT_ID,
  createBillingTestDb,
  seedBillingAccounts,
} from "./helpers/billing-ledger-fixtures";

describe("advanceSubscriptionCheckoutGeneration", () => {
  let db: PGlite;
  let client: SupabaseClient;
  beforeAll(async () => {
    db = await createBillingTestDb();
    await seedBillingAccounts(db);
    const queryable: Queryable = {
      query: async (text, values) => {
        const result = await db.query<Record<string, unknown>>(text, values);
        return {
          rows: result.rows,
          rowCount: result.affectedRows ?? result.rows.length,
        };
      },
    };
    client = createPostgrestShim(queryable) as unknown as SupabaseClient;
  });
  afterAll(async () => {
    await db.close();
  });

  async function storedGeneration() {
    const result = await db.query<{ generation: string }>(
      "select subscription_checkout_generation::text as generation from billing_accounts where id = $1",
      [ACCOUNT_ID]
    );
    return Number(result.rows[0]?.generation);
  }

  it("should advance once when two callers start from the same generation", async () => {
    const start = await storedGeneration();

    const first = await advanceSubscriptionCheckoutGeneration(
      ACCOUNT_ID,
      start,
      client
    );
    const second = await advanceSubscriptionCheckoutGeneration(
      ACCOUNT_ID,
      start,
      client
    );

    expect(first).toBe(start + 1);
    expect(second).toBe(start + 1);
    expect(await storedGeneration()).toBe(start + 1);
  });

  it("should never move a generation that has already advanced back", async () => {
    const start = await storedGeneration();
    await db.query(
      "update billing_accounts set subscription_checkout_generation = $2 where id = $1",
      [ACCOUNT_ID, start + 3]
    );

    const current = await advanceSubscriptionCheckoutGeneration(
      ACCOUNT_ID,
      start,
      client
    );

    expect(current).toBe(start + 3);
    expect(await storedGeneration()).toBe(start + 3);
  });

  it("should fail for an unknown billing account", async () => {
    await expect(
      advanceSubscriptionCheckoutGeneration(
        "00000000-0000-4000-8000-0000000000ff",
        0,
        client
      )
    ).rejects.toThrow(/not found/);
  });
});

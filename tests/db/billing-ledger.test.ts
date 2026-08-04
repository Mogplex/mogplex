import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ACCOUNT_ID = "00000000-0000-4000-8000-000000000001";
const USER_ID = "00000000-0000-4000-8000-000000000002";

describe("billing ledger migration", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    const migration = await readFile(
      path.resolve(
        import.meta.dirname,
        "../../neon/migrations/20260804200000_billing_foundation.sql"
      ),
      "utf8"
    );
    await db.exec(migration);
    await db.query(
      `insert into billing_accounts (id, owner_type, owner_user_id)
       values ($1, 'user', $2)`,
      [ACCOUNT_ID, USER_ID]
    );
  });

  afterAll(async () => {
    await db.close();
  });

  it("atomically grants the new period and expires prior included credit", async () => {
    await db.query(
      `select post_credit_ledger_entry(
         $1, 350, 'included', 'grant', 'grant:prior', '2026-07', '{}'
       )`,
      [ACCOUNT_ID]
    );

    const result = await db.query<{
      posted: boolean;
      expired_cents: number;
    }>(
      `select * from post_billing_period_grant(
         $1, 2000, 'grant:acct:2026-08:sub_1',
         'grantexp:acct:2026-08:sub_1', '2026-08', '{"invoice":"in_1"}'
       )`,
      [ACCOUNT_ID]
    );

    expect(result.rows).toEqual([{ posted: true, expired_cents: 350 }]);
    const balance = await db.query<{ included_cents: number }>(
      "select included_cents from billing_balance($1)",
      [ACCOUNT_ID]
    );
    expect(balance.rows[0]?.included_cents).toBe(2000);
  });

  it("deduplicates redelivery but grants a new same-month subscription", async () => {
    const duplicate = await db.query<{ posted: boolean }>(
      `select posted from post_billing_period_grant(
         $1, 2000, 'grant:acct:2026-08:sub_1',
         'grantexp:acct:2026-08:sub_1', '2026-08', '{}'
       )`,
      [ACCOUNT_ID]
    );
    expect(duplicate.rows[0]?.posted).toBe(false);

    await db.query(
      `select post_credit_ledger_entry(
         $1, -2000, 'included', 'grant_expiry',
         'grantexp:acct:cancel:sub_1', null, '{}'
       )`,
      [ACCOUNT_ID]
    );
    const resubscribe = await db.query<{
      posted: boolean;
      expired_cents: number;
    }>(
      `select * from post_billing_period_grant(
         $1, 2000, 'grant:acct:2026-08:sub_2',
         'grantexp:acct:2026-08:sub_2', '2026-08', '{}'
       )`,
      [ACCOUNT_ID]
    );
    expect(resubscribe.rows).toEqual([{ posted: true, expired_cents: 0 }]);

    const balance = await db.query<{ included_cents: number }>(
      "select included_cents from billing_balance($1)",
      [ACCOUNT_ID]
    );
    expect(balance.rows[0]?.included_cents).toBe(2000);
  });
});

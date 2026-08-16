import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import {
  BILLING_JOB_RUN_STUB_SQL,
  SANDBOX_BILLING_SANDBOX_STUB_SQL,
} from "../harness";

export const ACCOUNT_ID = "00000000-0000-4000-8000-000000000001";
export const USER_ID = "00000000-0000-4000-8000-000000000002";
export const CANCELLATION_ACCOUNT_ID = "00000000-0000-4000-8000-000000000003";
export const CANCELLATION_USER_ID = "00000000-0000-4000-8000-000000000004";
export const USAGE_ACCOUNT_ID = "00000000-0000-4000-8000-000000000005";
export const USAGE_USER_ID = "00000000-0000-4000-8000-000000000006";
export const SANDBOX_ACCOUNT_ID = "00000000-0000-4000-8000-000000000007";
export const SANDBOX_USER_ID = "00000000-0000-4000-8000-000000000008";
export const MINIMUM_ACCOUNT_ID = "00000000-0000-4000-8000-000000000009";
export const MINIMUM_USER_ID = "00000000-0000-4000-8000-000000000010";
export const NEGATIVE_ACCOUNT_ID = "00000000-0000-4000-8000-000000000011";
export const NEGATIVE_USER_ID = "00000000-0000-4000-8000-000000000012";
export const SANDBOX_RECORD_ID = "00000000-0000-4000-8000-000000000013";
export const MINIMUM_SANDBOX_ONE_ID = "00000000-0000-4000-8000-000000000014";
export const MINIMUM_SANDBOX_TWO_ID = "00000000-0000-4000-8000-000000000015";
export const NEGATIVE_SANDBOX_ID = "00000000-0000-4000-8000-000000000016";
export const LIFECYCLE_SANDBOX_ID = "00000000-0000-4000-8000-000000000017";
export const MISMATCH_SANDBOX_ID = "00000000-0000-4000-8000-000000000018";
export const RECOVERY_SANDBOX_ID = "00000000-0000-4000-8000-000000000019";
export const RECOVERY_CURSOR_TARGET_ID = "00000000-0000-4000-8000-000000000020";
export const TOKEN_ACCRUAL_ACCOUNT_ID = "00000000-0000-4000-8000-000000000021";
export const TOKEN_ACCRUAL_USER_ID = "00000000-0000-4000-8000-000000000022";
export const LEGACY_TOKEN_ACCOUNT_ID = "00000000-0000-4000-8000-000000000023";
export const LEGACY_TOKEN_USER_ID = "00000000-0000-4000-8000-000000000024";
export const LEGACY_ROUNDUP_ACCOUNT_ID = "00000000-0000-4000-8000-000000000025";
export const LEGACY_ROUNDUP_USER_ID = "00000000-0000-4000-8000-000000000026";
export const LEGACY_RECOVERY_ACCOUNT_ID =
  "00000000-0000-4000-8000-000000000027";
export const LEGACY_RECOVERY_USER_ID = "00000000-0000-4000-8000-000000000028";

const BILLING_MIGRATIONS = [
  "20260804200000_billing_foundation.sql",
  "20260804210000_atomic_billing_cancellation_expiry.sql",
  "20260805060000_billing_usage_debits.sql",
  "20260805070000_sandbox_billing_sessions.sql",
  "20260805090000_sandbox_billing_open_balance_and_close_barrier.sql",
  "20260805140000_exact_token_usage_accrual.sql",
  "20260805190000_harden_sandbox_billing_close_contract.sql",
  "20260816120000_capacity_billing_shadow_foundation.sql",
  "20260816140000_capacity_billing_shadow_state.sql",
  "20260816150000_capacity_billing_workflow_admission.sql",
  "20260816160000_capacity_billing_rollback_status.sql",
  "20260816170000_capacity_billing_summary_views.sql",
];

export async function createBillingTestDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
  `);
  await db.exec(SANDBOX_BILLING_SANDBOX_STUB_SQL);
  await db.exec(BILLING_JOB_RUN_STUB_SQL);
  for (const migrationName of BILLING_MIGRATIONS) {
    const migration = await readFile(
      path.resolve(
        import.meta.dirname,
        `../../../neon/migrations/${migrationName}`
      ),
      "utf8"
    );
    await db.exec(migration);
  }
  return db;
}

export async function seedBillingAccounts(db: PGlite): Promise<void> {
  await db.query(
    `insert into billing_accounts (id, owner_type, owner_user_id)
     values ($1, 'user', $2), ($3, 'user', $4), ($5, 'user', $6),
            ($7, 'user', $8), ($9, 'user', $10), ($11, 'user', $12),
            ($13, 'user', $14), ($15, 'user', $16),
            ($17, 'user', $18), ($19, 'user', $20)`,
    [
      ACCOUNT_ID,
      USER_ID,
      CANCELLATION_ACCOUNT_ID,
      CANCELLATION_USER_ID,
      USAGE_ACCOUNT_ID,
      USAGE_USER_ID,
      SANDBOX_ACCOUNT_ID,
      SANDBOX_USER_ID,
      MINIMUM_ACCOUNT_ID,
      MINIMUM_USER_ID,
      NEGATIVE_ACCOUNT_ID,
      NEGATIVE_USER_ID,
      TOKEN_ACCRUAL_ACCOUNT_ID,
      TOKEN_ACCRUAL_USER_ID,
      LEGACY_TOKEN_ACCOUNT_ID,
      LEGACY_TOKEN_USER_ID,
      LEGACY_ROUNDUP_ACCOUNT_ID,
      LEGACY_ROUNDUP_USER_ID,
      LEGACY_RECOVERY_ACCOUNT_ID,
      LEGACY_RECOVERY_USER_ID,
    ]
  );
}

export async function seedSandboxes(db: PGlite): Promise<void> {
  await db.query(
    `insert into sandboxes
       (id, user_id, actor_user_id, product_team_id, sandbox_id, billing_source)
     values
       ($1, $2, $2, null, 'sbx_provider_1', 'platform'),
       ($3, $4, $4, null, 'sbx_min_1', 'platform'),
       ($5, $4, $4, null, 'sbx_min_2', 'platform'),
       ($6, $7, $7, null, 'sbx_negative', 'platform'),
       ($8, $2, $2, null, 'sbx_lifecycle', 'platform'),
       ($9, $2, $2, null, 'sbx_mismatch', 'user_vercel_project')`,
    [
      SANDBOX_RECORD_ID,
      SANDBOX_USER_ID,
      MINIMUM_SANDBOX_ONE_ID,
      MINIMUM_USER_ID,
      MINIMUM_SANDBOX_TWO_ID,
      NEGATIVE_SANDBOX_ID,
      NEGATIVE_USER_ID,
      LIFECYCLE_SANDBOX_ID,
      MISMATCH_SANDBOX_ID,
    ]
  );
}

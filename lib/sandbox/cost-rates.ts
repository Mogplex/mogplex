// Sandbox cost estimation.
// Wall-clock seconds × rate is a proxy for real Vercel Sandbox spend. The rate
// is intentionally coarse and will be calibrated against actual invoices. Used
// for unit-economics telemetry only, never for user-facing billing.

// Kept in sync with supabase/migrations/20260417120100_sandbox_cost_trigger.sql,
// which hard-codes the same default in the BEFORE UPDATE trigger. If you tune
// this rate, update the trigger in a follow-up migration.
export const DEFAULT_CENTS_PER_COMPUTE_SECOND = 0.0028;

type CostRateEnv = {
  PLATFORM_SANDBOX_COST_CENTS_PER_SECOND?: string;
};

export function getSandboxCostCentsPerSecond(env?: CostRateEnv): number {
  const raw = (env ?? process.env).PLATFORM_SANDBOX_COST_CENTS_PER_SECOND;
  if (!raw) return DEFAULT_CENTS_PER_COMPUTE_SECOND;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_CENTS_PER_COMPUTE_SECOND;
}

// Returns true when the operator has set a non-empty, valid positive override
// via PLATFORM_SANDBOX_COST_CENTS_PER_SECOND. Checks env presence directly to
// avoid float-equality comparisons against the default.
export function hasSandboxCostRateOverride(env?: CostRateEnv): boolean {
  const raw = (env ?? process.env).PLATFORM_SANDBOX_COST_CENTS_PER_SECOND;
  if (!raw) return false;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0;
}

export function estimateSandboxCostCents(
  computeSeconds: number,
  env?: CostRateEnv
): number {
  if (!Number.isFinite(computeSeconds) || computeSeconds <= 0) return 0;
  const cents = computeSeconds * getSandboxCostCentsPerSecond(env);
  return Math.round(cents * 10000) / 10000;
}

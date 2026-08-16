import type { SupabaseClient } from "@supabase/supabase-js";
import { getOrCreateBillingAccount } from "@/lib/billing/accounts";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { ProductResourceScope } from "@/lib/team-resource-scope";
import type { JobRunStartSource } from "@/lib/job-runs";
import type { StartDispatchContext } from "@/lib/workflows/automation-job-types";

export const ACCOUNT_CONCURRENCY_LIMIT = "ACCOUNT_CONCURRENCY_LIMIT";

export type WorkflowCapacityAdmissionDecision = {
  tracked: boolean;
  accountId: string | null;
  posted: boolean;
  admitted: boolean;
  wouldAdmit: boolean;
  activeBefore: number;
  concurrencyLimit: number;
  accountingMode: "shadow" | "meter_only" | "enforced" | null;
};

type AdmissionRow = {
  posted?: unknown;
  admitted?: unknown;
  would_admit?: unknown;
  active_before?: unknown;
  concurrency_limit?: unknown;
  accounting_mode?: unknown;
};

function requiredBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} returned an invalid boolean`);
  }
  return value;
}

function requiredInteger(value: unknown, label: string): number {
  if (typeof value !== "number" && typeof value !== "string") {
    throw new TypeError(`${label} returned an invalid integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new TypeError(`${label} returned an invalid integer`);
  }
  return parsed;
}

function requiredMode(value: unknown): "shadow" | "meter_only" | "enforced" {
  if (value !== "shadow" && value !== "meter_only" && value !== "enforced") {
    throw new TypeError("workflow capacity returned an invalid mode");
  }
  return value;
}

async function resolveAutomationBillingScope(
  context: StartDispatchContext,
  client: SupabaseClient
): Promise<ProductResourceScope | null> {
  let ownerUserId = context.userId.trim();
  let productTeamId: string | null = null;

  if (context.repoId) {
    const { data, error } = await client
      .from("repos")
      .select("user_id, product_team_id")
      .eq("id", context.repoId)
      .maybeSingle();
    if (error) {
      throw new Error(
        `Failed to resolve workflow billing scope: ${error.message}`
      );
    }

    if (typeof data?.user_id === "string" && data.user_id.trim()) {
      ownerUserId = data.user_id.trim();
    }
    if (
      typeof data?.product_team_id === "string" &&
      data.product_team_id.trim()
    ) {
      productTeamId = data.product_team_id.trim();
    }
  }

  if (!ownerUserId) return null;
  return productTeamId
    ? { kind: "team", userId: ownerUserId, productTeamId }
    : { kind: "personal", userId: ownerUserId, productTeamId: null };
}

export async function admitAutomationJobCapacity(
  input: {
    jobRunId: string;
    source: JobRunStartSource;
    attemptedAt: string;
    context: StartDispatchContext | null;
  },
  client: SupabaseClient = supabaseAdmin
): Promise<WorkflowCapacityAdmissionDecision> {
  if (!input.context) {
    return {
      tracked: false,
      accountId: null,
      posted: false,
      admitted: true,
      wouldAdmit: true,
      activeBefore: 0,
      concurrencyLimit: 0,
      accountingMode: null,
    };
  }

  const scope = await resolveAutomationBillingScope(input.context, client);
  if (!scope) {
    return {
      tracked: false,
      accountId: null,
      posted: false,
      admitted: true,
      wouldAdmit: true,
      activeBefore: 0,
      concurrencyLimit: 0,
      accountingMode: null,
    };
  }

  const account = await getOrCreateBillingAccount(scope, client);
  const suffix = `${input.jobRunId}:${input.source}:${input.attemptedAt}`;
  const { data, error } = await client.rpc("admit_billing_workflow_capacity", {
    p_account: account.id,
    p_admission_ref: `automation-job-admission:${suffix}`,
    p_source_ref: `automation-job-start:${suffix}`,
    p_lease_ref: `automation-job-lease:${suffix}`,
    p_root_workflow_ref: input.jobRunId,
    p_attempted_at: input.attemptedAt,
    p_metadata: {
      startSource: input.source,
      sourceKind: input.context.sourceKind,
      sourceType: input.context.sourceType,
      repoId: input.context.repoId,
      installationId: input.context.installationId,
    },
  });
  if (error) {
    throw new Error(`Workflow capacity admission failed: ${error.message}`);
  }

  const row = (Array.isArray(data) ? data[0] : data) as AdmissionRow | null;
  if (!row || typeof row !== "object") {
    throw new Error("Workflow capacity admission returned no result");
  }

  return {
    tracked: true,
    accountId: account.id,
    posted: requiredBoolean(row.posted, "workflow capacity admission"),
    admitted: requiredBoolean(row.admitted, "workflow capacity admission"),
    wouldAdmit: requiredBoolean(row.would_admit, "workflow capacity admission"),
    activeBefore: requiredInteger(
      row.active_before,
      "workflow capacity admission"
    ),
    concurrencyLimit: requiredInteger(
      row.concurrency_limit,
      "workflow capacity admission"
    ),
    accountingMode: requiredMode(row.accounting_mode),
  };
}

export async function rollbackAutomationJobCapacityStart(
  input: {
    jobRunId: string;
    sourceRef: string;
    rolledBackAt: string;
    metadata?: Record<string, unknown>;
  },
  client: SupabaseClient = supabaseAdmin
): Promise<{ reset: boolean; leaseReleased: boolean }> {
  const { data, error } = await client.rpc(
    "rollback_billing_automation_job_start",
    {
      p_job_run_id: input.jobRunId,
      p_source_ref: input.sourceRef,
      p_rolled_back_at: input.rolledBackAt,
      p_metadata: input.metadata ?? {},
    }
  );
  if (error) {
    throw new Error(`Workflow capacity rollback failed: ${error.message}`);
  }

  const row = (Array.isArray(data) ? data[0] : data) as {
    reset?: unknown;
    lease_released?: unknown;
  } | null;
  if (!row || typeof row !== "object") {
    throw new Error("Workflow capacity rollback returned no result");
  }
  return {
    reset: requiredBoolean(row.reset, "workflow capacity rollback"),
    leaseReleased: requiredBoolean(
      row.lease_released,
      "workflow capacity rollback"
    ),
  };
}

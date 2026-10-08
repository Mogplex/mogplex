import { randomUUID } from "node:crypto";
import { enqueueAutomationJobRun } from "@/lib/automation-dispatch";
import { loadOwnedFlow } from "@/lib/flows/api";
import {
  buildApiRunInputMetadata,
  validateAutomationInput,
} from "@/lib/flows/automation-inputs";
import { coerceGraph, getStartConfig } from "@/lib/flows/graph";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { startAutomationJobRun } from "@/lib/workflows/automation-job-workflow";
import {
  MogplexApiAutomationError,
  type TriggerMogplexApiAutomationInput,
} from "./automations.types";

type TriggerRepo = {
  id: string;
  full_name: string;
  github_installation_id: number | null;
  default_branch: string | null;
  product_team_id: string | null;
};

type ExistingJobRun = {
  id: string;
  status: string;
  metadata: Record<string, unknown> | null;
};

export type AutomationTriggerDeps = {
  loadFlow: typeof loadOwnedFlow;
  loadRepo: (userId: string, repoId: string) => Promise<TriggerRepo | null>;
  loadJobRun: (
    jobRunId: string,
    flowId: string
  ) => Promise<ExistingJobRun | null>;
  loadCredentialLabel: (
    kind: "integration" | "interactive",
    keyId: string
  ) => Promise<string | null>;
  enqueue: typeof enqueueAutomationJobRun;
  start: typeof startAutomationJobRun;
};

// Keys the run derives from its automation, repository and trigger. A caller
// on a legacy (non-API) automation may pass extra metadata for conditions and
// prompts, but never these: `flow_auto_merge`, for one, unlocks PR merge tools.
const RESERVED_LEGACY_INPUT =
  /^(flow_|repo_|sandbox_|source|dispatch_|trigger|input|working_branch$|installation_id$|team_id$|default_branch$|webhook$|slack$|schedule$)/;

async function loadRepo(userId: string, repoId: string) {
  const { data, error } = await supabaseAdmin
    .from("repos")
    .select(
      "id, full_name, github_installation_id, default_branch, product_team_id"
    )
    .eq("id", repoId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data ?? null) as TriggerRepo | null;
}

async function loadJobRun(jobRunId: string, flowId: string) {
  const { data, error } = await supabaseAdmin
    .from("job_runs")
    .select("id, status, metadata")
    .eq("id", jobRunId)
    .eq("flow_id", flowId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data ?? null) as ExistingJobRun | null;
}

async function loadCredentialLabel(
  kind: "integration" | "interactive",
  keyId: string
) {
  if (kind !== "integration") return null;
  const { data } = await supabaseAdmin
    .from("user_api_keys")
    .select("name")
    .eq("id", keyId)
    .maybeSingle();
  return typeof data?.name === "string" ? data.name : null;
}

const defaultDeps: AutomationTriggerDeps = {
  loadFlow: loadOwnedFlow,
  loadRepo,
  loadJobRun,
  loadCredentialLabel,
  enqueue: enqueueAutomationJobRun,
  start: startAutomationJobRun,
};

function rejectUnusableAutomation(
  flow: Awaited<ReturnType<typeof loadOwnedFlow>>,
  automationOnly: boolean
) {
  if (!flow) {
    throw new MogplexApiAutomationError(
      "AUTOMATION_NOT_FOUND",
      "Automation not found. Work must reference an existing automation owned by this account.",
      404
    );
  }
  if (!flow.published_version_id || !flow.published_version) {
    throw new MogplexApiAutomationError(
      "AUTOMATION_NOT_PUBLISHED",
      "Publish the automation before triggering it",
      409
    );
  }
  if (flow.status !== "active") {
    throw new MogplexApiAutomationError(
      "AUTOMATION_INACTIVE",
      "This automation is disabled. Enable it in Mogplex before triggering it.",
      409
    );
  }
  const graph = coerceGraph(flow.published_version.graph);
  const start = getStartConfig(graph);
  if (automationOnly && start?.event !== "api") {
    throw new MogplexApiAutomationError(
      "AUTOMATION_NOT_INTEGRATION_ENABLED",
      "This API key can trigger only automations with an API trigger. Set this automation's trigger to API in Mogplex and declare its inputs.",
      403
    );
  }
  return { flow, start };
}

function assertRepoAllowed(
  repo: TriggerRepo | null,
  installationId: number,
  allowedRepos: readonly string[] | undefined
): TriggerRepo {
  if (!repo) {
    throw new MogplexApiAutomationError(
      "REPO_NOT_FOUND",
      "Repository not found",
      404
    );
  }
  if (repo.github_installation_id !== installationId) {
    throw new MogplexApiAutomationError(
      "REPO_SCOPE_MISMATCH",
      "Repository is outside this automation's GitHub installation"
    );
  }
  if (allowedRepos?.length && !allowedRepos.includes(repo.full_name)) {
    throw new MogplexApiAutomationError(
      "REPO_NOT_ALLOWED",
      "This automation is not configured for that repository.",
      403
    );
  }
  return repo;
}

function acceptInput(
  start: ReturnType<typeof getStartConfig>,
  input: Record<string, unknown> | undefined
) {
  if (start?.event === "api") {
    const validation = validateAutomationInput(start.inputFields ?? [], input);
    if (!validation.ok) {
      throw new MogplexApiAutomationError(
        "INVALID_INPUT",
        validation.errors.join(" "),
        400
      );
    }
    return { snapshot: validation.value, legacy: {} };
  }
  const legacy = Object.fromEntries(
    Object.entries(input ?? {}).filter(
      ([key]) => !RESERVED_LEGACY_INPUT.test(key)
    )
  );
  return { snapshot: input ?? {}, legacy };
}

/**
 * Starts one run of an owned, published, enabled automation. Every check
 * happens before anything is queued, so a refused request creates no run,
 * sandbox or branch.
 *
 * Idempotency keys are scoped to the account and automation. A replay with
 * the same input returns the original run; the same key with different input
 * is a conflict rather than a second build.
 */
export function createTriggerMogplexApiAutomation(
  overrides: Partial<AutomationTriggerDeps> = {}
) {
  const deps: AutomationTriggerDeps = { ...defaultDeps, ...overrides };

  return async function triggerMogplexApiAutomation(
    input: TriggerMogplexApiAutomationInput
  ) {
    const credentialKind = input.credential?.kind ?? "interactive";
    const { flow, start } = rejectUnusableAutomation(
      await deps.loadFlow(input.userId, input.automationId),
      input.credential?.automationOnly === true
    );
    const repo = assertRepoAllowed(
      await deps.loadRepo(input.userId, input.repoId),
      flow.installation_id,
      start?.filter?.repos
    );
    const accepted = acceptInput(start, input.input);
    const version = flow.published_version!;
    const sourceType = start?.event ?? "flow";
    const scopedKey = `api:${input.userId}:${flow.id}:${input.idempotencyKey || randomUUID()}`;
    const isApiAutomation = sourceType === "api";
    const runInput = await buildApiRunInputMetadata({
      scopedIdempotencyKey: scopedKey,
      value: accepted.snapshot,
    });

    const metadata = {
      ...accepted.legacy,
      source: isApiAutomation ? "api" : "mcp",
      source_type: sourceType,
      dispatch_source: credentialKind === "integration" ? "integration" : "mcp",
      flow_id: flow.id,
      flow_version_id: version.id,
      flow_version_number: version.version_number,
      repo_id: repo.id,
      repo_full_name: repo.full_name,
      installation_id: repo.github_installation_id,
      default_branch: repo.default_branch,
      team_id: repo.product_team_id,
      input: runInput.input,
      input_hash: runInput.input_hash,
      trigger: {
        credential: credentialKind,
        key_id: input.credential?.keyId ?? null,
        label: input.credential
          ? await deps.loadCredentialLabel(
              credentialKind,
              input.credential.keyId
            )
          : null,
      },
      ...(isApiAutomation ? { working_branch: runInput.working_branch } : {}),
    };

    const enqueue = await deps.enqueue({
      userId: input.userId,
      flowId: flow.id,
      flowVersionId: version.id,
      repoId: repo.id,
      installationId: repo.github_installation_id,
      sourceKind: "flow",
      sourceType,
      idempotencyKey: scopedKey,
      metadata,
    });

    const base = {
      automationId: flow.id,
      versionId: version.id,
      versionNumber: version.version_number,
      jobRunId: enqueue.jobRunId,
      workingBranch:
        typeof metadata.working_branch === "string"
          ? metadata.working_branch
          : null,
    };

    if (enqueue.reason === "IDEMPOTENT_DUPLICATE" && enqueue.jobRunId) {
      const existing = await deps.loadJobRun(enqueue.jobRunId, flow.id);
      if (existing?.metadata?.input_hash !== runInput.input_hash) {
        throw new MogplexApiAutomationError(
          "IDEMPOTENCY_CONFLICT",
          "This Idempotency-Key was already used with different input. Use a new key for a new build.",
          409
        );
      }
      return {
        ...base,
        outcome: "replayed" as const,
        reason: enqueue.reason,
        replayed: true,
        started: false,
        status: existing.status,
        runtime: null,
      };
    }

    if (enqueue.outcome !== "queued" || !enqueue.jobRunId) {
      return {
        ...base,
        outcome: enqueue.outcome,
        reason: enqueue.reason,
        replayed: false,
        started: false,
        status: "suppressed" as const,
        runtime: null,
      };
    }

    const started = await deps.start(enqueue.jobRunId, "api");
    return {
      ...base,
      outcome: enqueue.outcome,
      reason: started.reason ?? enqueue.reason,
      replayed: false,
      started: started.started,
      status: started.status,
      runtime: {
        provider: started.runtimeProvider ?? null,
        runId: started.runtimeRunId ?? started.workflowRunId ?? null,
      },
    };
  };
}

export const triggerMogplexApiAutomation = createTriggerMogplexApiAutomation();

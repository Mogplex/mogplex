import { randomUUID } from "node:crypto";
import { enqueueAutomationJobRun } from "@/lib/automation-dispatch";
import {
  createFlowForUser,
  listOwnedFlowRuns,
  loadOwnedFlow,
  loadOwnedFlowRunDetail,
  publishFlowDraft,
  updateFlow,
} from "@/lib/flows/api";
import { cloneFlowGraph, coerceGraph, getStartConfig } from "@/lib/flows/graph";
import { startAutomationJobRun } from "@/lib/workflows/automation-job-workflow";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { Flow, FlowGraph } from "@/lib/types";

export type MogplexApiAutomation = {
  id: string;
  installationId: number;
  name: string;
  description: string | null;
  notes: string | null;
  status: "active" | "inactive";
  draftGraph: FlowGraph;
  publishedVersion: {
    id: string;
    versionNumber: number;
    graph: FlowGraph;
    createdAt: string;
  } | null;
  createdAt: string;
  updatedAt: string;
  runSummary: {
    lastRunId: string | null;
    lastRunStatus: string | null;
    runningCount: number;
    pendingCount: number;
    failed24h: number;
  };
};

export const MOGPLEX_API_DEFAULT_AUTOMATIONS_LIMIT = 50;
export const MOGPLEX_API_MAX_AUTOMATIONS_LIMIT = 100;

export type MogplexApiAutomationSummary = {
  id: string;
  installationId: number;
  name: string;
  description: string | null;
  status: "active" | "inactive";
  publishedVersionId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MogplexApiAutomationCursor = {
  createdAt: string;
  id: string;
};

export type ListMogplexApiAutomationsOptions = {
  limit?: number;
  cursor?: MogplexApiAutomationCursor | null;
};

export type ListMogplexApiAutomationsResult = {
  automations: MogplexApiAutomationSummary[];
  nextCursor: string | null;
};

type MogplexApiAutomationSummaryRow = {
  id: string;
  installation_id: number;
  name: string;
  description: string | null;
  status: "active" | "inactive";
  published_version_id: string | null;
  created_at: string;
  updated_at: string;
};

const ISO_CURSOR_DATE_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;
const UUID_CURSOR_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function isValidAutomationCursorDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    ISO_CURSOR_DATE_PATTERN.test(value) &&
    !Number.isNaN(new Date(value).getTime())
  );
}

function isValidAutomationCursorId(value: unknown): value is string {
  return typeof value === "string" && UUID_CURSOR_PATTERN.test(value);
}

export function encodeMogplexApiAutomationCursor(
  row: Pick<MogplexApiAutomationSummaryRow, "created_at" | "id">
) {
  return Buffer.from(
    JSON.stringify({ createdAt: row.created_at, id: row.id }),
    "utf8"
  ).toString("base64url");
}

export function parseMogplexApiAutomationCursor(
  raw: string | null
): MogplexApiAutomationCursor | null | undefined {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8")
    ) as { createdAt?: unknown; id?: unknown };
    if (
      isValidAutomationCursorDate(parsed.createdAt) &&
      isValidAutomationCursorId(parsed.id)
    ) {
      return { createdAt: parsed.createdAt, id: parsed.id };
    }
  } catch {
    // Invalid opaque cursors are rejected by the route before querying.
  }

  return undefined;
}

function presentMogplexApiAutomationSummary(
  row: MogplexApiAutomationSummaryRow
): MogplexApiAutomationSummary {
  return {
    id: row.id,
    installationId: row.installation_id,
    name: row.name,
    description: row.description,
    status: row.status,
    publishedVersionId: row.published_version_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type CreateMogplexApiAutomationInput = {
  installationId: number;
  name?: string | null;
  description?: string | null;
  notes?: string | null;
  graph?: FlowGraph;
  publish?: boolean;
};

export type UpdateMogplexApiAutomationInput = {
  name?: string;
  description?: string | null;
  notes?: string | null;
  installationId?: number;
  graph?: FlowGraph;
};

export type TriggerMogplexApiAutomationInput = {
  userId: string;
  automationId: string;
  repoId: string;
  idempotencyKey: string;
  input?: Record<string, unknown>;
};

export class MogplexApiAutomationError extends Error {
  constructor(
    public readonly code:
      | "AUTOMATION_INACTIVE"
      | "AUTOMATION_NOT_FOUND"
      | "AUTOMATION_NOT_PUBLISHED"
      | "AUTOMATION_NODE_NOT_FOUND"
      | "AUTOMATION_NODE_NOT_AGENT"
      | "MODEL_NOT_AVAILABLE"
      | "REPO_NOT_FOUND"
      | "REPO_SCOPE_MISMATCH",
    message: string,
    public readonly status: 400 | 404 | 409 = 400
  ) {
    super(message);
    this.name = "MogplexApiAutomationError";
  }
}

function toRunCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function presentMogplexApiAutomation(flow: Flow): MogplexApiAutomation {
  return {
    id: flow.id,
    installationId: flow.installation_id,
    name: flow.name,
    description: flow.description,
    notes: flow.notes,
    status: flow.status,
    draftGraph: coerceGraph(flow.draft_graph),
    publishedVersion: flow.published_version
      ? {
          id: flow.published_version.id,
          versionNumber: flow.published_version.version_number,
          graph: coerceGraph(flow.published_version.graph),
          createdAt: flow.published_version.created_at,
        }
      : null,
    createdAt: flow.created_at,
    updatedAt: flow.updated_at,
    runSummary: {
      lastRunId: flow.last_job_run_id ?? null,
      lastRunStatus: flow.last_run_status ?? null,
      runningCount: toRunCount(flow.running_count),
      pendingCount: toRunCount(flow.pending_count),
      failed24h: toRunCount(flow.failed_24h),
    },
  };
}

export async function listMogplexApiAutomations(
  userId: string,
  options: ListMogplexApiAutomationsOptions = {}
): Promise<ListMogplexApiAutomationsResult> {
  const limit = Math.min(
    MOGPLEX_API_MAX_AUTOMATIONS_LIMIT,
    Math.max(1, options.limit ?? MOGPLEX_API_DEFAULT_AUTOMATIONS_LIMIT)
  );
  let query = supabaseAdmin
    .from("flows")
    .select(
      "id, installation_id, name, description, status, published_version_id, created_at, updated_at"
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  if (options.cursor) {
    query = query.or(
      `created_at.lt.${options.cursor.createdAt},and(created_at.eq.${options.cursor.createdAt},id.lt.${options.cursor.id})`
    );
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as MogplexApiAutomationSummaryRow[];
  const pageRows = rows.slice(0, limit);
  return {
    automations: pageRows.map(presentMogplexApiAutomationSummary),
    nextCursor:
      rows.length > limit && pageRows.at(-1)
        ? encodeMogplexApiAutomationCursor(pageRows.at(-1)!)
        : null,
  };
}

export async function getMogplexApiAutomation(
  userId: string,
  automationId: string
) {
  const flow = await loadOwnedFlow(userId, automationId);
  if (!flow) {
    throw new MogplexApiAutomationError(
      "AUTOMATION_NOT_FOUND",
      "Automation not found",
      404
    );
  }
  return presentMogplexApiAutomation(flow);
}

// The v1 API is key-scoped and carries no active-team header, so the
// updateFlow / publishFlowDraft calls below intentionally omit teamId and
// preset forks resolve in personal scope — consistent with
// listMogplexApiAgents' preset model stamping.
export async function createMogplexApiAutomation(
  userId: string,
  input: CreateMogplexApiAutomationInput
) {
  let flow = await createFlowForUser({
    userId,
    installationId: input.installationId,
    name: input.name,
  });

  if (
    input.description !== undefined ||
    input.notes !== undefined ||
    input.graph !== undefined
  ) {
    flow = await updateFlow({
      userId,
      flowId: flow!.id,
      description: input.description,
      notes: input.notes,
      draftGraph: input.graph,
    });
  }

  if (input.publish) {
    flow = await publishFlowDraft(userId, flow!.id);
  }

  return presentMogplexApiAutomation(flow!);
}

export async function updateMogplexApiAutomation(
  userId: string,
  automationId: string,
  input: UpdateMogplexApiAutomationInput
) {
  await getMogplexApiAutomation(userId, automationId);
  const flow = await updateFlow({
    userId,
    flowId: automationId,
    name: input.name,
    description: input.description,
    notes: input.notes,
    installationId: input.installationId,
    draftGraph: input.graph,
  });
  return presentMogplexApiAutomation(flow!);
}

export async function publishMogplexApiAutomation(
  userId: string,
  automationId: string
) {
  await getMogplexApiAutomation(userId, automationId);
  const flow = await publishFlowDraft(userId, automationId);
  return presentMogplexApiAutomation(flow!);
}

export async function setMogplexApiAutomationModel(input: {
  userId: string;
  automationId: string;
  nodeId: string;
  modelId: string | null;
  publish?: boolean;
  isModelAvailable?: (userId: string, modelId: string) => Promise<boolean>;
}) {
  const flow = await loadOwnedFlow(input.userId, input.automationId);
  if (!flow) {
    throw new MogplexApiAutomationError(
      "AUTOMATION_NOT_FOUND",
      "Automation not found",
      404
    );
  }

  if (
    input.modelId &&
    input.isModelAvailable &&
    !(await input.isModelAvailable(input.userId, input.modelId))
  ) {
    throw new MogplexApiAutomationError(
      "MODEL_NOT_AVAILABLE",
      "Model is not enabled and available for this user"
    );
  }

  const graph = cloneFlowGraph(coerceGraph(flow.draft_graph));
  const node = graph.nodes.find((candidate) => candidate.id === input.nodeId);
  if (!node) {
    throw new MogplexApiAutomationError(
      "AUTOMATION_NODE_NOT_FOUND",
      "Automation node not found",
      404
    );
  }
  if (node.type !== "agent") {
    throw new MogplexApiAutomationError(
      "AUTOMATION_NODE_NOT_AGENT",
      "Only agent nodes can have a model override"
    );
  }

  node.data = { ...node.data, modelOverride: input.modelId };
  let updated = await updateFlow({
    userId: input.userId,
    flowId: input.automationId,
    draftGraph: graph,
  });
  if (input.publish) {
    updated = await publishFlowDraft(input.userId, input.automationId);
  }
  return presentMogplexApiAutomation(updated!);
}

async function loadOwnedRepoForAutomation(userId: string, repoId: string) {
  const { data, error } = await supabaseAdmin
    .from("repos")
    .select("id, full_name, github_installation_id, default_branch")
    .eq("id", repoId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function triggerMogplexApiAutomation(
  input: TriggerMogplexApiAutomationInput
) {
  const flow = await loadOwnedFlow(input.userId, input.automationId);
  if (!flow) {
    throw new MogplexApiAutomationError(
      "AUTOMATION_NOT_FOUND",
      "Automation not found",
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
      "Activate the automation before triggering it",
      409
    );
  }

  const repo = await loadOwnedRepoForAutomation(input.userId, input.repoId);
  if (!repo) {
    throw new MogplexApiAutomationError(
      "REPO_NOT_FOUND",
      "Repository not found",
      404
    );
  }
  if (repo.github_installation_id !== flow.installation_id) {
    throw new MogplexApiAutomationError(
      "REPO_SCOPE_MISMATCH",
      "Repository is outside this automation's GitHub installation"
    );
  }

  const sourceType =
    getStartConfig(flow.published_version.graph)?.event ?? "flow";
  const metadata = {
    ...input.input,
    source: "mcp",
    source_type: sourceType,
    dispatch_source: "mcp",
    flow_id: flow.id,
    flow_version_id: flow.published_version_id,
    repo_id: repo.id,
    repo_full_name: repo.full_name,
    installation_id: repo.github_installation_id,
    default_branch: repo.default_branch,
  };
  const enqueue = await enqueueAutomationJobRun({
    userId: input.userId,
    flowId: flow.id,
    flowVersionId: flow.published_version_id,
    repoId: repo.id,
    installationId: repo.github_installation_id,
    sourceKind: "flow",
    sourceType,
    idempotencyKey: input.idempotencyKey || `mcp:${randomUUID()}`,
    metadata,
  });

  if (enqueue.outcome !== "queued" || !enqueue.jobRunId) {
    return {
      automationId: flow.id,
      jobRunId: enqueue.jobRunId,
      outcome: enqueue.outcome,
      reason: enqueue.reason,
      started: false,
      status: "suppressed" as const,
      runtime: null,
    };
  }

  const started = await startAutomationJobRun(enqueue.jobRunId, "api");
  return {
    automationId: flow.id,
    jobRunId: enqueue.jobRunId,
    outcome: enqueue.outcome,
    reason: started.reason ?? enqueue.reason,
    started: started.started,
    status: started.status,
    runtime: {
      provider: started.runtimeProvider ?? null,
      runId: started.runtimeRunId ?? started.workflowRunId ?? null,
    },
  };
}

export async function listMogplexApiAutomationRuns(
  userId: string,
  automationId: string,
  limit = 20
) {
  await getMogplexApiAutomation(userId, automationId);
  return listOwnedFlowRuns(userId, automationId, limit);
}

export async function getMogplexApiAutomationRunLogs(
  userId: string,
  automationId: string,
  runId: string
) {
  await getMogplexApiAutomation(userId, automationId);
  return loadOwnedFlowRunDetail(userId, automationId, runId);
}

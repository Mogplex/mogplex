import { randomUUID } from "node:crypto";
import { summarizeEntityDispatchEvents } from "@/lib/automation-dispatch";
import { FlowServiceError } from "@/lib/flows/errors";
import {
  coerceGraph,
  createDefaultFlowGraph,
  getStartConfig,
  validateFlowGraph,
} from "@/lib/flows/graph";
import {
  bindFlowGraphToScope,
  buildFlowStarterTemplateGraph,
  flowTemplateRequiresRepository,
  getFlowTemplateReconnects,
  getFlowStarterTemplate,
  preparePersonalFlowTemplateGraphForValidation,
  sanitizeFlowGraphForPersonalTemplate,
  sanitizeFlowGraphForTeamTemplate,
  type FlowStarterTemplateId,
} from "@/lib/flows/templates";
import type { ProductResourceScope } from "@/lib/team-resource-scope";
import {
  getJobRunSourceKind,
  isCancelableJobRun,
  isRepairableJobRun,
  isRequeueableJobRun,
  summarizeEntityJobRuns,
} from "@/lib/job-runs";
import type { AutomationDispatchEventOutcome } from "@/lib/automation-dispatch";
import type {
  AiCall,
  AiCallEvent,
  Flow,
  FlowGraph,
  FlowNodeRun,
  PersonalFlowTemplate,
  FlowRunDetail,
  FlowRunRecord,
  TriggerEvent,
} from "@/lib/types";

type TestInstallation = {
  id: string;
  user_id: string;
  installation_id: number;
  account_login: string | null;
};

type TestAgent = {
  id: string;
  user_id: string;
  name: string;
  slug: string | null;
  model: string;
  system_prompt: string | null;
};

type TestFlowRow = {
  id: string;
  user_id: string;
  installation_id: number;
  name: string;
  description: string | null;
  notes: string | null;
  source_kind: "github";
  status: "active" | "inactive";
  draft_graph: FlowGraph;
  published_version_id: string | null;
  created_at: string;
  updated_at: string;
};

type TestFlowVersionRow = {
  id: string;
  flow_id: string;
  version_number: number;
  graph: FlowGraph;
  created_at: string;
};

type TestPersonalFlowTemplateRow = {
  id: string;
  user_id: string;
  owner_type?: "user" | "team";
  owner_user_id?: string | null;
  product_team_id?: string | null;
  created_by_user_id?: string | null;
  name: string;
  description: string | null;
  graph: FlowGraph;
  source_flow_id: string | null;
  trigger_event: PersonalFlowTemplate["trigger_event"];
  reconnect: PersonalFlowTemplate["reconnect"];
  requires_repository: boolean;
  created_at: string;
  updated_at: string;
};

type TestTriggerRow = {
  id: string;
  user_id: string;
  installation_id: number;
  agent_id: string | null;
  event: TriggerEvent;
  is_default: boolean;
  enabled: boolean;
};

type TestJobRunRow = {
  id: string;
  assignment_id?: string | null;
  trigger_id?: string | null;
  flow_id: string | null;
  flow_version_id?: string | null;
  runtime_provider?: string | null;
  runtime_run_id?: string | null;
  workflow_run_id?: string | null;
  retry_of_job_run_id?: string | null;
  status: string | null;
  error: string | null;
  started_at: string | null;
  created_at: string | null;
  completed_at?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cost_usd?: number | null;
  duration_ms?: number | null;
  start_attempts?: number;
  last_start_attempt_at: string | null;
  last_start_error?: string | null;
  last_start_source?:
    | "webhook"
    | "cron"
    | "repair"
    | "manual_retry"
    | "queue_release"
    | null;
  cancel_requested_at?: string | null;
  cancelled_at?: string | null;
  cancel_reason?: string | null;
  cancel_error?: string | null;
  metadata?: Record<string, unknown> | null;
};

type TestDispatchEventRow = {
  id: string;
  job_run_id?: string | null;
  trigger_id: string | null;
  flow_id?: string | null;
  flow_version_id?: string | null;
  event_kind?: "enqueue" | "start" | "control";
  outcome: AutomationDispatchEventOutcome;
  reason: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
};

type TestAiCallRow = Omit<
  AiCall,
  "type" | "status" | "control_state" | "tool_calls" | "metadata"
> & {
  type: AiCall["type"];
  status: AiCall["status"];
  control_state?: AiCall["control_state"];
  tool_calls?: AiCall["tool_calls"];
  metadata?: AiCall["metadata"];
};

type TestAiCallEventRow = Omit<AiCallEvent, "event_type" | "payload"> & {
  event_type: AiCallEvent["event_type"];
  payload?: AiCallEvent["payload"];
};

type TestAssistantState = {
  nextResult: { summary: string; graph: FlowGraph } | null;
  nextError: string | null;
};

type TestFaultState = {
  failNextFlowDelete: string | null;
};

export type FlowsE2ETestState = {
  installations: TestInstallation[];
  agents: TestAgent[];
  flows: TestFlowRow[];
  flowVersions: TestFlowVersionRow[];
  flowTemplates: TestPersonalFlowTemplateRow[];
  triggers: TestTriggerRow[];
  jobRuns: TestJobRunRow[];
  flowNodeRuns: FlowNodeRun[];
  dispatchEvents: TestDispatchEventRow[];
  aiCalls: TestAiCallRow[];
  aiCallEvents: TestAiCallEventRow[];
  assistant: TestAssistantState;
  faults: TestFaultState;
};

declare global {
  var __MOGPLEX_FLOWS_E2E_STATE: FlowsE2ETestState | undefined;
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function nowIso() {
  return new Date().toISOString();
}

function defaultState(): FlowsE2ETestState {
  return {
    installations: [],
    agents: [],
    flows: [],
    flowVersions: [],
    flowTemplates: [],
    triggers: [],
    jobRuns: [],
    flowNodeRuns: [],
    dispatchEvents: [],
    aiCalls: [],
    aiCallEvents: [],
    assistant: {
      nextResult: null,
      nextError: null,
    },
    faults: {
      failNextFlowDelete: null,
    },
  };
}

export function isFlowsE2ETestMode() {
  return process.env.PLAYWRIGHT === "1";
}

function getState() {
  if (!globalThis.__MOGPLEX_FLOWS_E2E_STATE) {
    globalThis.__MOGPLEX_FLOWS_E2E_STATE = defaultState();
  }

  return globalThis.__MOGPLEX_FLOWS_E2E_STATE;
}

function serializeFlow(row: TestFlowRow) {
  const state = getState();
  const publishedVersion = row.published_version_id
    ? (state.flowVersions.find(
        (version) => version.id === row.published_version_id
      ) ?? null)
    : null;

  return {
    ...row,
    draft_graph: deepClone(row.draft_graph),
    published_version: publishedVersion
      ? {
          ...publishedVersion,
          graph: deepClone(publishedVersion.graph),
        }
      : null,
  } satisfies Flow;
}

function serializePersonalFlowTemplate(
  row: TestPersonalFlowTemplateRow
): PersonalFlowTemplate & { graph: FlowGraph } {
  const ownerType = row.owner_type ?? "user";
  return {
    id: row.id,
    owner_type: ownerType,
    owner_user_id:
      row.owner_user_id ?? (ownerType === "user" ? row.user_id : null),
    product_team_id: row.product_team_id ?? null,
    created_by_user_id: row.created_by_user_id ?? row.user_id,
    name: row.name,
    description: row.description,
    graph: deepClone(row.graph),
    source_flow_id: ownerType === "team" ? null : row.source_flow_id,
    trigger_event: row.trigger_event,
    reconnect: row.reconnect,
    requires_repository: row.requires_repository,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function summarizePersonalFlowTemplate(
  template: PersonalFlowTemplate & { graph: FlowGraph }
): PersonalFlowTemplate {
  const { graph: _graph, ...summary } = template;
  return summary;
}

function repairFlowPublicationConsistency(row: TestFlowRow) {
  if (row.status !== "active" || row.published_version_id) {
    return row;
  }

  const state = getState();
  const latestVersion =
    state.flowVersions
      .filter((version) => version.flow_id === row.id)
      .sort((a, b) => b.version_number - a.version_number)[0] ?? null;

  row.updated_at = nowIso();

  if (latestVersion) {
    row.published_version_id = latestVersion.id;
  } else {
    row.status = "inactive";
  }

  return row;
}

function loadOwnedFlowRow(userId: string, flowId: string) {
  return (
    getState().flows.find(
      (flow) => flow.id === flowId && flow.user_id === userId
    ) ?? null
  );
}

function requireOwnedFlowRow(userId: string, flowId: string) {
  const flow = loadOwnedFlowRow(userId, flowId);
  if (!flow) {
    throw new FlowServiceError("FLOW_NOT_FOUND", "Flow not found");
  }
  return flow;
}

function assertOwnedInstallation(userId: string, installationId: number) {
  const installation = getState().installations.find(
    (candidate) =>
      candidate.user_id === userId &&
      candidate.installation_id === installationId
  );

  if (!installation) {
    throw new FlowServiceError(
      "FLOW_INSTALLATION_NOT_FOUND",
      "Installation not found"
    );
  }

  return installation;
}

function assertOwnedAgents(userId: string, graph: FlowGraph) {
  const agentIds = Array.from(
    new Set(
      graph.nodes
        .filter((node) => node.type === "agent")
        .map((node) =>
          typeof node.data.agentId === "string" ? node.data.agentId : null
        )
        .filter(Boolean) as string[]
    )
  );

  if (agentIds.length === 0) return;

  const ownedIds = new Set(
    getState()
      .agents.filter((agent) => agent.user_id === userId)
      .map((agent) => agent.id)
  );

  const missing = agentIds.find((agentId) => !ownedIds.has(agentId));
  if (missing) {
    throw new FlowServiceError(
      "FLOW_AGENT_FORBIDDEN",
      `Agent "${missing}" is not available to this user.`
    );
  }
}

function consumeFault(name: keyof TestFaultState) {
  const state = getState();
  const message = state.faults[name];
  state.faults[name] = null;
  return message;
}

export function resetFlowsE2ETestState(seed?: Partial<FlowsE2ETestState>) {
  const next = defaultState();

  if (seed) {
    next.installations = deepClone(seed.installations || []);
    next.agents = deepClone(seed.agents || []);
    next.flows = deepClone(seed.flows || []);
    next.flowVersions = deepClone(seed.flowVersions || []);
    next.flowTemplates = deepClone(seed.flowTemplates || []);
    next.triggers = deepClone(seed.triggers || []);
    next.jobRuns = deepClone(seed.jobRuns || []);
    next.flowNodeRuns = deepClone(seed.flowNodeRuns || []);
    next.dispatchEvents = deepClone(seed.dispatchEvents || []);
    next.aiCalls = deepClone(seed.aiCalls || []);
    next.aiCallEvents = deepClone(seed.aiCallEvents || []);
    next.assistant = {
      nextResult: seed.assistant?.nextResult
        ? deepClone(seed.assistant.nextResult)
        : null,
      nextError: seed.assistant?.nextError ?? null,
    };
    next.faults = {
      failNextFlowDelete: seed.faults?.failNextFlowDelete ?? null,
    };
  }

  globalThis.__MOGPLEX_FLOWS_E2E_STATE = next;
  return snapshotFlowsE2ETestState();
}

export function snapshotFlowsE2ETestState() {
  return deepClone(getState());
}

export async function listOwnedFlowsWithSummaries(userId: string) {
  const state = getState();
  const flows = state.flows
    .filter((flow) => flow.user_id === userId)
    .sort(
      (left, right) =>
        new Date(right.created_at).getTime() -
        new Date(left.created_at).getTime()
    );

  return flows.map((flow) => {
    const consistentFlow = repairFlowPublicationConsistency(flow);
    const runs = state.jobRuns.filter((run) => run.flow_id === flow.id);
    const runIds = new Set(runs.map((run) => run.id));
    const events = state.dispatchEvents.filter(
      (event) =>
        event.flow_id === flow.id ||
        (event.job_run_id ? runIds.has(event.job_run_id) : false)
    );
    return {
      ...serializeFlow(consistentFlow),
      ...summarizeEntityJobRuns(runs),
      ...summarizeEntityDispatchEvents(events),
    };
  });
}

export async function listOwnedFlowRuns(
  userId: string,
  flowId: string,
  limit = 12
) {
  requireOwnedFlowRow(userId, flowId);
  const state = getState();
  const runs = state.jobRuns
    .filter((run) => run.flow_id === flowId)
    .sort(
      (left, right) =>
        new Date(right.created_at || 0).getTime() -
        new Date(left.created_at || 0).getTime()
    )
    .slice(0, limit);

  return runs.map<FlowRunRecord>((run) => {
    const latestDispatchEvent =
      state.dispatchEvents
        .filter((event) => event.job_run_id === run.id)
        .sort(
          (left, right) =>
            new Date(right.created_at).getTime() -
            new Date(left.created_at).getTime()
        )[0] ?? null;
    const nodeRuns = state.flowNodeRuns.filter(
      (nodeRun) => nodeRun.job_run_id === run.id
    );
    const flowVersionId =
      typeof run.flow_version_id === "string"
        ? run.flow_version_id
        : typeof run.metadata?.flow_version_id === "string"
          ? run.metadata.flow_version_id
          : null;
    const flowVersion = flowVersionId
      ? (state.flowVersions.find(
          (candidate) => candidate.id === flowVersionId
        ) ?? null)
      : null;

    return {
      id: run.id,
      assignment_id: run.assignment_id ?? null,
      trigger_id: run.trigger_id ?? null,
      flow_id: run.flow_id,
      flow_version_id: run.flow_version_id ?? null,
      runtime_provider:
        (run.runtime_provider as "trigger" | "workflow" | null | undefined) ??
        null,
      runtime_run_id: run.runtime_run_id ?? null,
      workflow_run_id: run.workflow_run_id ?? null,
      retry_of_job_run_id: run.retry_of_job_run_id ?? null,
      status:
        (run.status as
          | "pending"
          | "running"
          | "success"
          | "failed"
          | "cancelled") ?? "pending",
      created_at: run.created_at || nowIso(),
      started_at: run.started_at,
      completed_at: run.completed_at ?? null,
      input_tokens: run.input_tokens ?? null,
      output_tokens: run.output_tokens ?? null,
      cost_usd: run.cost_usd ?? null,
      duration_ms: run.duration_ms ?? null,

      error: run.error,
      start_attempts: run.start_attempts ?? 0,
      last_start_attempt_at: run.last_start_attempt_at,
      last_start_error: run.last_start_error ?? null,
      last_start_source: run.last_start_source ?? null,
      cancel_requested_at: run.cancel_requested_at ?? null,
      cancelled_at: run.cancelled_at ?? null,
      cancel_reason: run.cancel_reason ?? null,
      cancel_error: run.cancel_error ?? null,
      metadata: run.metadata ?? null,
      source_kind: getJobRunSourceKind(run),
      source_type:
        typeof run.metadata?.source_type === "string"
          ? run.metadata.source_type
          : flowVersion
            ? (getStartConfig(flowVersion.graph)?.event ?? "flow")
            : "flow",
      repo: {
        id:
          typeof run.metadata?.repo_id === "string"
            ? run.metadata.repo_id
            : null,
        full_name:
          typeof run.metadata?.repo_full_name === "string"
            ? run.metadata.repo_full_name
            : null,
      },
      agent: {
        id: null,
        name: null,
        slug: null,
      },
      latest_ai_call: null,
      repairable: isRepairableJobRun(run),
      requeueable: isRequeueableJobRun(run),
      cancelable: isCancelableJobRun(run),
      active_wait_count: 0,
      latest_dispatch_event: latestDispatchEvent
        ? {
            id: latestDispatchEvent.id,
            event_kind: latestDispatchEvent.event_kind ?? "start",
            outcome: latestDispatchEvent.outcome,
            reason: latestDispatchEvent.reason,
            metadata: deepClone(latestDispatchEvent.metadata || {}),
            created_at: latestDispatchEvent.created_at,
          }
        : null,
      node_runs: deepClone(nodeRuns),
    };
  });
}

export async function loadOwnedFlowRunDetail(
  userId: string,
  flowId: string,
  runId: string
) {
  requireOwnedFlowRow(userId, flowId);
  const state = getState();
  const run =
    state.jobRuns.find(
      (candidate) => candidate.flow_id === flowId && candidate.id === runId
    ) ?? null;

  if (!run) {
    throw new FlowServiceError("FLOW_RUN_NOT_FOUND", "Run not found");
  }

  const dispatchEvents = state.dispatchEvents
    .filter((event) => event.job_run_id === run.id)
    .sort(
      (left, right) =>
        new Date(left.created_at).getTime() -
        new Date(right.created_at).getTime()
    );
  const nodeRuns = state.flowNodeRuns.filter(
    (nodeRun) => nodeRun.job_run_id === run.id
  );
  const aiCalls = state.aiCalls
    .filter((call) => call.job_run_id === run.id && call.user_id === userId)
    .sort(
      (left, right) =>
        new Date(left.started_at).getTime() -
        new Date(right.started_at).getTime()
    );
  const aiCallEventsByCallId = new Map<string, AiCallEvent[]>();
  for (const event of state.aiCallEvents) {
    const bucket = aiCallEventsByCallId.get(event.ai_call_id) || [];
    bucket.push({
      ...deepClone(event),
      payload: deepClone(event.payload || {}),
    });
    aiCallEventsByCallId.set(event.ai_call_id, bucket);
  }
  const latestDispatchEvent = dispatchEvents.at(-1) ?? null;
  const latestAiCall = aiCalls.at(-1) ?? null;
  const flowVersionId =
    typeof run.flow_version_id === "string"
      ? run.flow_version_id
      : typeof run.metadata?.flow_version_id === "string"
        ? run.metadata.flow_version_id
        : null;
  const flowVersion = flowVersionId
    ? (state.flowVersions.find((candidate) => candidate.id === flowVersionId) ??
      null)
    : null;

  return {
    id: run.id,
    assignment_id: run.assignment_id ?? null,
    trigger_id: run.trigger_id ?? null,
    flow_id: run.flow_id,
    flow_version_id: run.flow_version_id ?? null,
    runtime_provider:
      (run.runtime_provider as "trigger" | "workflow" | null | undefined) ??
      null,
    runtime_run_id: run.runtime_run_id ?? null,
    workflow_run_id: run.workflow_run_id ?? null,
    retry_of_job_run_id: run.retry_of_job_run_id ?? null,
    status:
      (run.status as
        | "pending"
        | "running"
        | "success"
        | "failed"
        | "cancelled") ?? "pending",
    created_at: run.created_at || nowIso(),
    started_at: run.started_at,
    completed_at: run.completed_at ?? null,
    input_tokens: run.input_tokens ?? null,
    output_tokens: run.output_tokens ?? null,
    cost_usd: run.cost_usd ?? null,
    duration_ms: run.duration_ms ?? null,
    error: run.error,
    start_attempts: run.start_attempts ?? 0,
    last_start_attempt_at: run.last_start_attempt_at,
    last_start_error: run.last_start_error ?? null,
    last_start_source: run.last_start_source ?? null,
    cancel_requested_at: run.cancel_requested_at ?? null,
    cancelled_at: run.cancelled_at ?? null,
    cancel_reason: run.cancel_reason ?? null,
    cancel_error: run.cancel_error ?? null,
    metadata: run.metadata ?? null,
    source_kind: getJobRunSourceKind(run),
    source_type:
      typeof run.metadata?.source_type === "string"
        ? run.metadata.source_type
        : flowVersion
          ? (getStartConfig(flowVersion.graph)?.event ?? "flow")
          : "flow",
    repo: {
      id:
        typeof run.metadata?.repo_id === "string" ? run.metadata.repo_id : null,
      full_name:
        typeof run.metadata?.repo_full_name === "string"
          ? run.metadata.repo_full_name
          : null,
    },
    agent: {
      id: null,
      name: null,
      slug: null,
    },
    latest_ai_call: latestAiCall
      ? {
          id: latestAiCall.id,
          status: latestAiCall.status,
          model: latestAiCall.model,
          total_tokens: latestAiCall.total_tokens,
          tool_calls_count: latestAiCall.tool_calls_count,
          started_at: latestAiCall.started_at,
        }
      : null,
    repairable: isRepairableJobRun(run),
    requeueable: isRequeueableJobRun(run),
    cancelable: isCancelableJobRun(run),
    active_wait_count: 0,
    latest_dispatch_event: latestDispatchEvent
      ? {
          id: latestDispatchEvent.id,
          event_kind: latestDispatchEvent.event_kind ?? "start",
          outcome: latestDispatchEvent.outcome,
          reason: latestDispatchEvent.reason,
          metadata: deepClone(latestDispatchEvent.metadata || {}),
          created_at: latestDispatchEvent.created_at,
        }
      : null,
    node_runs: deepClone(nodeRuns),
    dispatch_events: dispatchEvents.map((event) => ({
      id: event.id,
      event_kind: event.event_kind ?? "start",
      outcome: event.outcome,
      reason: event.reason,
      metadata: event.metadata ?? null,
      created_at: event.created_at,
    })),
    ai_calls: aiCalls.map((call) => ({
      ...call,
      control_state: call.control_state ?? "active",
      tool_calls: deepClone(call.tool_calls || []),
      metadata: deepClone(call.metadata || {}),
      events: aiCallEventsByCallId.get(call.id) || [],
    })),
    review_findings: [],
  } satisfies FlowRunDetail;
}

export async function loadOwnedFlow(userId: string, flowId: string) {
  const row = loadOwnedFlowRow(userId, flowId);
  return row ? serializeFlow(repairFlowPublicationConsistency(row)) : null;
}

export async function loadOwnedInstallation(
  userId: string,
  installationId: number
) {
  return (
    getState().installations.find(
      (installation) =>
        installation.user_id === userId &&
        installation.installation_id === installationId
    ) ?? null
  );
}

export async function buildDefaultFlowDraft(input: {
  userId: string;
  installationId: number;
  name?: string | null;
  templateId?: FlowStarterTemplateId | null;
  personalTemplateId?: string | null;
  teamTemplateId?: string | null;
  teamId?: string | null;
  repository?: string | null;
}) {
  assertOwnedInstallation(input.userId, input.installationId);
  const agent =
    getState().agents.find((candidate) => candidate.user_id === input.userId) ??
    null;
  const personalTemplate = input.personalTemplateId
    ? (getState().flowTemplates.find(
        (candidate) =>
          candidate.id === input.personalTemplateId &&
          (candidate.owner_type ?? "user") === "user" &&
          (candidate.owner_user_id ?? candidate.user_id) === input.userId
      ) ?? null)
    : null;
  const teamTemplate =
    input.teamTemplateId && input.teamId
      ? (getState().flowTemplates.find(
          (candidate) =>
            candidate.id === input.teamTemplateId &&
            (candidate.owner_type ?? "user") === "team" &&
            candidate.product_team_id === input.teamId
        ) ?? null)
      : null;
  if (input.personalTemplateId && !personalTemplate) {
    throw new FlowServiceError("FLOW_NOT_FOUND", "Workflow template not found");
  }
  if (input.teamTemplateId && !teamTemplate) {
    throw new FlowServiceError("FLOW_NOT_FOUND", "Workflow template not found");
  }
  const storedTemplate = personalTemplate ?? teamTemplate;

  const template = input.templateId
    ? getFlowStarterTemplate(input.templateId)
    : null;
  if (
    storedTemplate &&
    flowTemplateRequiresRepository(storedTemplate.graph) &&
    !input.repository?.trim()
  ) {
    throw new FlowServiceError(
      "FLOW_GRAPH_INVALID",
      "This workflow template requires a repository."
    );
  }
  const draftGraph = bindFlowGraphToScope(
    storedTemplate
      ? storedTemplate.graph
      : input.templateId
        ? buildFlowStarterTemplateGraph({
            templateId: input.templateId,
            agentId: agent?.id ?? null,
            agentName: agent?.name ?? "Agent",
          })
        : createDefaultFlowGraph({
            agentId: agent?.id ?? null,
            agentName: agent?.name ?? "Agent",
          }),
    {
      installationId: input.installationId,
      repository: input.repository,
    }
  );
  const validation = validateFlowGraph(
    storedTemplate
      ? preparePersonalFlowTemplateGraphForValidation(draftGraph)
      : draftGraph,
    { requireRunnableConfig: Boolean(personalTemplate) }
  );
  if (!validation.valid) {
    throw new FlowServiceError(
      "FLOW_GRAPH_INVALID",
      validation.errors[0] || "Workflow template is invalid",
      { details: validation.errors }
    );
  }
  assertOwnedAgents(input.userId, draftGraph);

  return {
    name:
      input.name?.trim() ||
      storedTemplate?.name ||
      template?.name ||
      "Untitled flow",
    description: storedTemplate?.description ?? template?.description ?? null,
    draftGraph,
  };
}

export async function createFlowForUser(input: {
  userId: string;
  installationId: number;
  name?: string | null;
  templateId?: FlowStarterTemplateId | null;
  personalTemplateId?: string | null;
  teamTemplateId?: string | null;
  teamId?: string | null;
  repository?: string | null;
}) {
  const draft = await buildDefaultFlowDraft(input);
  const createdAt = nowIso();
  const row: TestFlowRow = {
    id: randomUUID(),
    user_id: input.userId,
    installation_id: input.installationId,
    name: draft.name,
    description: draft.description,
    notes: null,
    source_kind: "github",
    status: "inactive",
    draft_graph: draft.draftGraph,
    published_version_id: null,
    created_at: createdAt,
    updated_at: createdAt,
  };

  getState().flows.push(row);
  return serializeFlow(row);
}

export async function updateFlow(input: {
  userId: string;
  flowId: string;
  name?: string;
  description?: string | null;
  notes?: string | null;
  installationId?: number;
  draftGraph?: FlowGraph;
}) {
  const flow = requireOwnedFlowRow(input.userId, input.flowId);

  if (
    input.installationId !== undefined &&
    (!Number.isFinite(input.installationId) || input.installationId <= 0)
  ) {
    throw new FlowServiceError(
      "FLOW_INVALID_INSTALLATION_ID",
      "Invalid installation_id"
    );
  }

  if (typeof input.installationId === "number") {
    assertOwnedInstallation(input.userId, input.installationId);
  }
  if (input.draftGraph) {
    assertOwnedAgents(input.userId, input.draftGraph);
  }

  if (typeof input.name === "string" && input.name.trim()) {
    flow.name = input.name.trim();
  }
  if (input.description !== undefined) {
    flow.description = input.description;
  }
  if (input.notes !== undefined) {
    flow.notes = input.notes;
  }
  if (typeof input.installationId === "number") {
    flow.installation_id = input.installationId;
  }
  if (input.draftGraph) {
    flow.draft_graph = input.draftGraph;
  }
  flow.updated_at = nowIso();

  return serializeFlow(flow);
}

export async function syncFlowActivation(
  userId: string,
  flowId: string,
  status: "active" | "inactive"
) {
  const flow = requireOwnedFlowRow(userId, flowId);
  if (status === "active" && !flow.published_version_id) {
    throw new FlowServiceError(
      "FLOW_UNPUBLISHED_ACTIVATION",
      "A flow must be published before it can be activated."
    );
  }

  flow.status = status;
  flow.updated_at = nowIso();

  return serializeFlow(flow);
}

export async function publishFlowDraft(userId: string, flowId: string) {
  const flow = requireOwnedFlowRow(userId, flowId);
  const graph = coerceGraph(flow.draft_graph);
  const validation = validateFlowGraph(graph);
  if (!validation.valid) {
    throw new FlowServiceError(
      "FLOW_GRAPH_INVALID",
      validation.errors[0] || "Flow graph is invalid",
      {
        details: validation.errors,
      }
    );
  }

  assertOwnedAgents(userId, graph);
  const startConfig = getStartConfig(graph);
  if (!startConfig) {
    throw new FlowServiceError(
      "FLOW_GRAPH_INVALID",
      "Flow start configuration is missing."
    );
  }
  const scopedInstallationIds = startConfig.filter?.installationIds ?? [];
  const publishedInstallationId =
    scopedInstallationIds.length === 1
      ? scopedInstallationIds[0]
      : flow.installation_id;
  if (
    !Number.isFinite(publishedInstallationId) ||
    publishedInstallationId <= 0
  ) {
    throw new FlowServiceError(
      "FLOW_INVALID_INSTALLATION_ID",
      "Invalid installation_id"
    );
  }
  if (publishedInstallationId !== flow.installation_id) {
    assertOwnedInstallation(userId, publishedInstallationId);
  }

  const state = getState();
  const latestVersionNumber = state.flowVersions
    .filter((version) => version.flow_id === flow.id)
    .reduce((max, version) => Math.max(max, version.version_number), 0);

  const version: TestFlowVersionRow = {
    id: randomUUID(),
    flow_id: flow.id,
    version_number: latestVersionNumber + 1,
    graph,
    created_at: nowIso(),
  };

  state.flowVersions.push(version);
  flow.installation_id = publishedInstallationId;
  flow.published_version_id = version.id;
  flow.status = "active";
  flow.updated_at = nowIso();

  return serializeFlow(flow);
}

export async function duplicateFlow(userId: string, flowId: string) {
  const flow = requireOwnedFlowRow(userId, flowId);
  const createdAt = nowIso();
  const duplicate: TestFlowRow = {
    id: randomUUID(),
    user_id: userId,
    installation_id: flow.installation_id,
    name: `${flow.name} Copy`,
    description: flow.description,
    notes: flow.notes,
    source_kind: flow.source_kind,
    status: "inactive",
    draft_graph: deepClone(flow.draft_graph),
    published_version_id: null,
    created_at: createdAt,
    updated_at: createdAt,
  };

  getState().flows.push(duplicate);
  return serializeFlow(duplicate);
}

const PERSONAL_FLOW_TEMPLATE_PAGE_SIZE = 25;

function testTemplateMatchesScope(
  template: TestPersonalFlowTemplateRow,
  scope: ProductResourceScope
) {
  const ownerType = template.owner_type ?? "user";
  return scope.kind === "team"
    ? ownerType === "team" && template.product_team_id === scope.productTeamId
    : ownerType === "user" &&
        (template.owner_user_id ?? template.user_id) === scope.userId;
}

export async function listFlowTemplates(
  scope: ProductResourceScope,
  cursor = 0
) {
  const rows = getState()
    .flowTemplates.filter((template) =>
      testTemplateMatchesScope(template, scope)
    )
    .sort(
      (left, right) =>
        right.updated_at.localeCompare(left.updated_at) ||
        right.id.localeCompare(left.id)
    )
    .slice(cursor, cursor + PERSONAL_FLOW_TEMPLATE_PAGE_SIZE + 1);
  const hasNextPage = rows.length > PERSONAL_FLOW_TEMPLATE_PAGE_SIZE;
  return {
    templates: rows
      .slice(0, PERSONAL_FLOW_TEMPLATE_PAGE_SIZE)
      .map(serializePersonalFlowTemplate)
      .map(summarizePersonalFlowTemplate),
    next_cursor: hasNextPage
      ? String(cursor + PERSONAL_FLOW_TEMPLATE_PAGE_SIZE)
      : null,
  };
}

export async function createFlowTemplate(input: {
  userId: string;
  flowId: string;
  name?: string | null;
  scope: ProductResourceScope;
}) {
  const flow = requireOwnedFlowRow(input.userId, input.flowId);
  const validation = validateFlowGraph(flow.draft_graph);
  if (!validation.valid) {
    throw new FlowServiceError(
      "FLOW_GRAPH_INVALID",
      validation.errors[0] || "Flow graph is invalid",
      { details: validation.errors }
    );
  }
  assertOwnedAgents(input.userId, flow.draft_graph);

  const graph =
    input.scope.kind === "team"
      ? sanitizeFlowGraphForTeamTemplate(flow.draft_graph)
      : sanitizeFlowGraphForPersonalTemplate(flow.draft_graph);
  const triggerEvent = getStartConfig(graph)?.event ?? "mention";
  const reconnect = getFlowTemplateReconnects(graph);
  const requiresRepository = flowTemplateRequiresRepository(graph);
  const templateValidation = validateFlowGraph(
    preparePersonalFlowTemplateGraphForValidation(graph),
    { requireRunnableConfig: input.scope.kind !== "team" }
  );
  if (!templateValidation.valid) {
    throw new FlowServiceError(
      "FLOW_GRAPH_INVALID",
      templateValidation.errors[0] || "Workflow template is invalid",
      { details: templateValidation.errors }
    );
  }

  const createdAt = nowIso();
  const template: TestPersonalFlowTemplateRow = {
    id: randomUUID(),
    user_id: input.userId,
    owner_type: input.scope.kind === "team" ? "team" : "user",
    owner_user_id: input.scope.kind === "team" ? null : input.scope.userId,
    product_team_id: input.scope.productTeamId,
    created_by_user_id: input.userId,
    name: input.name?.trim() || flow.name,
    description: flow.description,
    graph,
    source_flow_id: input.scope.kind === "team" ? null : flow.id,
    trigger_event: triggerEvent,
    reconnect,
    requires_repository: requiresRepository,
    created_at: createdAt,
    updated_at: createdAt,
  };
  getState().flowTemplates.push(template);
  return summarizePersonalFlowTemplate(serializePersonalFlowTemplate(template));
}

export async function listOwnedPersonalFlowTemplates(
  userId: string,
  cursor = 0
) {
  return listFlowTemplates(
    {
      kind: "personal",
      userId,
      productTeamId: null,
    },
    cursor
  );
}

export async function createPersonalFlowTemplate(input: {
  userId: string;
  flowId: string;
  name?: string | null;
}) {
  return createFlowTemplate({
    ...input,
    scope: {
      kind: "personal",
      userId: input.userId,
      productTeamId: null,
    },
  });
}

export async function deleteFlowTemplate(
  scope: ProductResourceScope,
  templateId: string
) {
  const state = getState();
  const before = state.flowTemplates.length;
  state.flowTemplates = state.flowTemplates.filter(
    (template) =>
      template.id !== templateId || !testTemplateMatchesScope(template, scope)
  );
  return state.flowTemplates.length < before;
}

export async function deleteFlow(userId: string, flowId: string) {
  const flow = requireOwnedFlowRow(userId, flowId);
  const state = getState();
  const flowFailure = consumeFault("failNextFlowDelete");

  if (flowFailure) {
    throw new FlowServiceError("FLOW_DELETE_SYNC_FAILED", flowFailure);
  }

  state.flows = state.flows.filter((candidate) => candidate.id !== flow.id);
  state.flowVersions = state.flowVersions.filter(
    (version) => version.flow_id !== flow.id
  );
  state.jobRuns = state.jobRuns.map((jobRun) =>
    jobRun.flow_id === flow.id ? { ...jobRun, flow_id: null } : jobRun
  );
  return { ok: true };
}

export async function generateFlowAssistantSuggestion(input: {
  userId: string;
  flowId: string;
  message: string;
  graph: FlowGraph;
}) {
  requireOwnedFlowRow(input.userId, input.flowId);
  const state = getState();

  if (state.assistant.nextError) {
    const error = state.assistant.nextError;
    state.assistant.nextError = null;
    throw new FlowServiceError("FLOW_STORAGE_FAILED", error);
  }

  const configured = state.assistant.nextResult;
  state.assistant.nextResult = null;

  if (configured) {
    const graph = coerceGraph(configured.graph);
    const validation = validateFlowGraph(graph, {
      requireRunnableConfig: true,
    });
    if (!validation.valid) {
      throw new FlowServiceError(
        "FLOW_ASSISTANT_INVALID_GRAPH",
        "Assistant produced an invalid flow graph",
        {
          details: validation.errors,
        }
      );
    }

    return {
      summary: configured.summary,
      graph,
    };
  }

  return {
    summary: `Updated flow for: ${input.message}`,
    graph: deepClone(input.graph),
  };
}

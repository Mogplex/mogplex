import { coerceGraph, getStartConfig } from "@/lib/flows/graph";
import type { FlowGraph, TriggerEvent } from "@/lib/types";
import type { JobRunStartSource } from "@/lib/job-runs";

export type PublishedFlowTriggerRow = {
  id: string;
  user_id: string;
  installation_id: number;
  status: "active" | "inactive";
  published_version_id: string | null;
  published_version:
    | { id: string; graph: unknown }
    | Array<{ id: string; graph: unknown }>
    | null;
};

export type TriggerRepoRow = {
  id: string;
  user_id: string;
  full_name: string;
  github_installation_id: number | null;
  product_team_id?: string | null;
};

export type FlowTriggerDispatchResult = {
  matched: boolean;
  outcome: "queued" | "suppressed";
  jobRunId: string | null;
  started: boolean;
  reason: string | null;
};

export type FlowTriggerDispatchDeps = {
  loadFlow: typeof loadPublishedFlow;
  resolveRepo: typeof resolveTriggerRepo;
  enqueue: typeof import("@/lib/automation-dispatch").enqueueAutomationJobRun;
  start: typeof import("@/lib/workflows/automation-job-workflow").startAutomationJobRun;
};

function publishedVersion(flow: PublishedFlowTriggerRow) {
  if (Array.isArray(flow.published_version)) {
    return flow.published_version[0] ?? null;
  }
  return flow.published_version;
}

async function loadPublishedFlow(
  flowId: string
): Promise<PublishedFlowTriggerRow | null> {
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  const { data, error } = await supabaseAdmin
    .from("flows")
    .select(
      "id, user_id, installation_id, status, published_version_id, published_version:flow_versions!flows_published_version_id_fkey(id, graph)"
    )
    .eq("id", flowId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load workflow trigger: ${error.message}`);
  }
  return (data ?? null) as PublishedFlowTriggerRow | null;
}

async function resolveTriggerRepo(input: {
  flow: PublishedFlowTriggerRow;
  graph: FlowGraph;
  repoFullName?: string | null;
}): Promise<TriggerRepoRow | null> {
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  const start = getStartConfig(input.graph);
  const repoFullName =
    input.repoFullName?.trim() || start?.filter?.repos?.[0]?.trim() || "";
  if (!repoFullName) return null;

  const { data, error } = await supabaseAdmin
    .from("repos")
    .select("id, user_id, full_name, github_installation_id, product_team_id")
    .eq("user_id", input.flow.user_id)
    .eq("github_installation_id", input.flow.installation_id)
    .eq("full_name", repoFullName)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to resolve workflow repository: ${error.message}`);
  }
  return (data ?? null) as TriggerRepoRow | null;
}

function triggerPayloadMetadata(
  event: TriggerEvent,
  payload: Record<string, unknown>
) {
  switch (event) {
    case "schedule":
      return { schedule: payload };
    case "webhook":
      return { webhook: payload };
    case "slack_mention":
      return { slack: payload };
    default:
      return { trigger_payload: payload };
  }
}

export type FlowTriggerDispatchInput = {
  flowId: string;
  event: TriggerEvent;
  idempotencyKey: string;
  payload?: Record<string, unknown>;
  repoFullName?: string | null;
  expectedUserId?: string | null;
  startSource?: JobRunStartSource;
};

export function createFlowTriggerDispatcher(
  overrides: Partial<FlowTriggerDispatchDeps> = {}
) {
  const deps: FlowTriggerDispatchDeps = {
    loadFlow: loadPublishedFlow,
    resolveRepo: resolveTriggerRepo,
    enqueue: async (input) => {
      const { enqueueAutomationJobRun } =
        await import("@/lib/automation-dispatch");
      return enqueueAutomationJobRun(input);
    },
    start: async (jobRunId, source) => {
      const { startAutomationJobRun } =
        await import("@/lib/workflows/automation-job-workflow");
      return startAutomationJobRun(jobRunId, source);
    },
    ...overrides,
  };

  return async function dispatchFlowTriggerWithDeps(
    input: FlowTriggerDispatchInput
  ): Promise<FlowTriggerDispatchResult> {
    const flow = await deps.loadFlow(input.flowId);
    const version = flow ? publishedVersion(flow) : null;
    if (flow?.status !== "active" || !flow.published_version_id || !version) {
      return {
        matched: false,
        outcome: "suppressed",
        jobRunId: null,
        started: false,
        reason: "FLOW_INACTIVE",
      };
    }
    if (input.expectedUserId && flow.user_id !== input.expectedUserId) {
      return {
        matched: false,
        outcome: "suppressed",
        jobRunId: null,
        started: false,
        reason: "FLOW_NOT_OWNED",
      };
    }

    const graph = coerceGraph(version.graph);
    const start = getStartConfig(graph);
    if (start?.event !== input.event) {
      return {
        matched: false,
        outcome: "suppressed",
        jobRunId: null,
        started: false,
        reason: "TRIGGER_MISMATCH",
      };
    }

    const repo = await deps.resolveRepo({
      flow,
      graph,
      repoFullName: input.repoFullName,
    });
    if (!repo) {
      return {
        matched: true,
        outcome: "suppressed",
        jobRunId: null,
        started: false,
        reason: "REPO_NOT_FOUND",
      };
    }

    const payload = input.payload ?? {};
    const metadata = {
      repo_id: repo.id,
      repo_full_name: repo.full_name,
      installation_id: flow.installation_id,
      team_id: repo.product_team_id ?? null,
      source_type: input.event,
      flow_id: flow.id,
      flow_version_id: version.id,
      ...triggerPayloadMetadata(input.event, payload),
    };
    const enqueued = await deps.enqueue({
      userId: flow.user_id,
      flowId: flow.id,
      flowVersionId: version.id,
      repoId: repo.id,
      installationId: flow.installation_id,
      sourceKind: "flow",
      sourceType: input.event,
      idempotencyKey: input.idempotencyKey,
      metadata,
      duplicateSensitive: input.event !== "schedule",
    });

    if (enqueued.outcome !== "queued" || !enqueued.jobRunId) {
      return {
        matched: true,
        outcome: "suppressed",
        jobRunId: enqueued.jobRunId,
        started: false,
        reason: enqueued.reason,
      };
    }

    const started = await deps.start(
      enqueued.jobRunId,
      input.startSource ?? (input.event === "schedule" ? "cron" : "webhook")
    );
    return {
      matched: true,
      outcome: "queued",
      jobRunId: enqueued.jobRunId,
      started: started.started,
      reason: started.reason ?? null,
    };
  };
}

export const dispatchFlowTrigger = createFlowTriggerDispatcher();

export function matchesSlackMentionTrigger(
  graph: FlowGraph,
  input: { teamId: string; channelId: string }
) {
  const start = getStartConfig(graph);
  return (
    start?.event === "slack_mention" &&
    start.slackTeamId === input.teamId &&
    start.slackChannelId === input.channelId
  );
}

export async function dispatchSlackMentionWorkflows(input: {
  userId: string;
  teamId: string;
  channelId: string;
  channelName?: string | null;
  eventId: string;
  slackUserId: string;
  text: string;
  messageTs: string;
  threadTs: string;
}) {
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  const { data, error } = await supabaseAdmin
    .from("flows")
    .select(
      "id, published_version:flow_versions!flows_published_version_id_fkey(id, graph)"
    )
    .eq("user_id", input.userId)
    .eq("status", "active")
    .not("published_version_id", "is", null);

  if (error) {
    throw new Error(`Failed to load Slack workflows: ${error.message}`);
  }

  const matchingFlowIds = (data ?? []).flatMap((row) => {
    const rawVersion = Array.isArray(row.published_version)
      ? row.published_version[0]
      : row.published_version;
    if (!rawVersion) return [];
    return matchesSlackMentionTrigger(coerceGraph(rawVersion.graph), input)
      ? [row.id as string]
      : [];
  });

  return Promise.all(
    matchingFlowIds.map((flowId) =>
      dispatchFlowTrigger({
        flowId,
        event: "slack_mention",
        idempotencyKey: `slack-flow:${input.eventId}:${flowId}`,
        expectedUserId: input.userId,
        payload: {
          team_id: input.teamId,
          channel_id: input.channelId,
          channel_name: input.channelName ?? null,
          user_id: input.slackUserId,
          text: input.text,
          message_ts: input.messageTs,
          thread_ts: input.threadTs,
        },
      })
    )
  );
}

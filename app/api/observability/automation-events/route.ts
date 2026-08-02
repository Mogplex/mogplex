import { NextResponse } from "next/server";
import {
  getAutomationDispatchSourceKind,
  loadUserAutomationDispatchEvents,
} from "@/lib/automation-dispatch";
import { requireUserId } from "@/lib/auth";
import { resolveFlowVersionAttribution } from "@/lib/job-run-service";
import type { NextRequest } from "next/server";
import type { AutomationDispatchEvent } from "@/lib/types";

type EventFilters = {
  page: number;
  limit: number;
  outcome?: string;
  reason?: string;
  repoId?: string;
  sourceKind?: string;
  sourceType?: string;
  agentId?: string;
  from?: string;
  to?: string;
};

function parseFilters(req: NextRequest): EventFilters {
  const params = req.nextUrl.searchParams;
  return {
    page: Math.max(1, Number.parseInt(params.get("page") || "1", 10)),
    limit: Math.min(
      100,
      Math.max(1, Number.parseInt(params.get("limit") || "50", 10))
    ),
    outcome: params.get("outcome") || undefined,
    reason: params.get("reason") || undefined,
    repoId: params.get("repo_id") || undefined,
    sourceKind: params.get("source_kind") || undefined,
    sourceType: params.get("source_type") || undefined,
    agentId: params.get("agent_id") || undefined,
    from: params.get("from") || undefined,
    to: params.get("to") || undefined,
  };
}

export async function GET(req: NextRequest) {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  const filters = parseFilters(req);
  const { scope, events, total } = await loadUserAutomationDispatchEvents({
    userId,
    page: filters.page,
    limit: filters.limit,
    outcome: filters.outcome,
    reason: filters.reason,
    repoId: filters.repoId,
    sourceKind: filters.sourceKind,
    sourceType: filters.sourceType,
    agentId: filters.agentId,
    from: filters.from,
    to: filters.to,
  });

  const normalized = events.map<AutomationDispatchEvent>((event) => {
    const assignment = event.assignment_id
      ? scope.assignmentsById.get(event.assignment_id)
      : null;
    const trigger = event.trigger_id
      ? scope.triggersById.get(event.trigger_id)
      : null;
    const flowAttribution = resolveFlowVersionAttribution(scope, {
      flowId: event.flow_id,
      flowVersionId: event.flow_version_id,
      metadata: event.metadata,
    });
    const flowAgent = flowAttribution?.primaryAgentId
      ? scope.agentsById.get(flowAttribution.primaryAgentId)
      : null;
    const repo = event.repo_id
      ? scope.reposById.get(event.repo_id)
      : assignment
        ? scope.reposById.get(assignment.repo_id)
        : null;
    const agent = assignment
      ? scope.agentsById.get(assignment.agent_id)
      : trigger
        ? scope.agentsById.get(trigger.agent_id)
        : flowAgent;

    return {
      ...event,
      source_kind: getAutomationDispatchSourceKind(event),
      repo: {
        id: repo?.id || event.repo_id || null,
        full_name: repo?.full_name || null,
      },
      agent: {
        id: agent?.id || null,
        name: agent?.name || null,
        slug: agent?.slug || null,
      },
    };
  });

  return NextResponse.json({
    events: normalized,
    total,
    page: filters.page,
    limit: filters.limit,
  });
}

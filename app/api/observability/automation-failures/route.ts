import { NextRequest, NextResponse } from "next/server";
import {
  buildAutomationFailureBreakdowns,
  buildAutomationFailureFilterOptions,
  deriveAutomationProvider,
  filterAutomationFailureRecords,
  formatAutomationFailureClassLabel,
  presentAutomationFailureDiagnostics,
  summarizeAutomationResilience,
  type AutomationFailureRecord,
} from "@/lib/automation-failure-observability";
import { getAutomationDispatchSourceKind } from "@/lib/automation-dispatch";
import { formatAutomationReasonLabel } from "@/lib/automation-review";
import { requireUserId } from "@/lib/auth";
import {
  loadUserAutomationScope,
  resolveFlowVersionAttribution,
} from "@/lib/job-run-service";
import { supabaseAdmin } from "@/lib/supabase/admin";

type AutomationFailureFilters = {
  page: number;
  limit: number;
  failureClass?: string;
  sourceType?: string;
  provider?: string;
  model?: string;
  from?: string;
  to?: string;
};

type AutomationDispatchEventRow = {
  id: string;
  job_run_id: string | null;
  assignment_id: string | null;
  trigger_id: string | null;
  flow_id: string | null;
  flow_version_id: string | null;
  repo_id: string | null;
  source_kind: "assignment" | "trigger" | "flow" | "manual_retry";
  source_type: string;
  outcome: "completed" | "failed";
  reason: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

function parseFilters(req: NextRequest): AutomationFailureFilters {
  const params = req.nextUrl.searchParams;

  return {
    page: Math.max(1, Number.parseInt(params.get("page") || "1", 10)),
    limit: Math.min(
      100,
      Math.max(1, Number.parseInt(params.get("limit") || "25", 10))
    ),
    failureClass: params.get("failure_class") || undefined,
    sourceType: params.get("source_type") || undefined,
    provider: params.get("provider") || undefined,
    model: params.get("model") || undefined,
    from: params.get("from") || undefined,
    to: params.get("to") || undefined,
  };
}

export async function GET(req: NextRequest) {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  const filters = parseFilters(req);
  let query = supabaseAdmin
    .from("automation_dispatch_events")
    .select(
      "id, job_run_id, assignment_id, trigger_id, flow_id, flow_version_id, repo_id, source_kind, source_type, outcome, reason, metadata, created_at"
    )
    .eq("user_id", userId)
    .eq("event_kind", "control")
    .in("outcome", ["completed", "failed"]);

  if (filters.from) query = query.gte("created_at", filters.from);
  if (filters.to) query = query.lte("created_at", filters.to);

  // Post-fetch scope filtering forces an in-memory page, but with PostgREST
  // max_rows raised the fetch itself needs a hard ceiling.
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(10000);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const events = (data || []) as AutomationDispatchEventRow[];
  const scope = await loadUserAutomationScope(userId, {
    flowVersionIds: Array.from(
      new Set(
        events.flatMap((event) =>
          [
            event.flow_version_id,
            typeof event.metadata?.flow_version_id === "string"
              ? event.metadata.flow_version_id
              : null,
          ].filter(
            (value): value is string =>
              typeof value === "string" && value.length > 0
          )
        )
      )
    ),
  });

  const records = events.map<AutomationFailureRecord>((event) => {
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
    const agent = assignment
      ? scope.agentsById.get(assignment.agent_id)
      : trigger
        ? scope.agentsById.get(trigger.agent_id)
        : flowAttribution?.primaryAgentId
          ? scope.agentsById.get(flowAttribution.primaryAgentId)
          : null;
    const repo = event.repo_id
      ? scope.reposById.get(event.repo_id)
      : assignment
        ? scope.reposById.get(assignment.repo_id)
        : null;
    const diagnostics = presentAutomationFailureDiagnostics(event.metadata);
    const normalizedDiagnostics =
      event.outcome === "failed" && diagnostics.failureClass == null
        ? {
            ...diagnostics,
            failureClass: "unknown" as const,
            failureLabel: formatAutomationFailureClassLabel("unknown"),
          }
        : diagnostics;
    const model = agent?.model ?? null;

    return {
      id: event.id,
      jobRunId: event.job_run_id,
      createdAt: event.created_at,
      sourceKind: getAutomationDispatchSourceKind(event),
      sourceType: event.source_type,
      reason: event.reason,
      reasonLabel: formatAutomationReasonLabel(event.reason, event.metadata),
      outcome: event.outcome,
      repo: {
        id: repo?.id || event.repo_id || null,
        fullName: repo?.full_name || null,
      },
      agent: {
        id: agent?.id || null,
        name: agent?.name || null,
        slug: agent?.slug || null,
        model,
        provider: deriveAutomationProvider(model),
      },
      diagnostics: normalizedDiagnostics,
      metadata: event.metadata ?? null,
    };
  });

  const failedRecords = records.filter((record) => record.outcome === "failed");
  const filterOptions = buildAutomationFailureFilterOptions(failedRecords);
  const filteredFailedRecords = filterAutomationFailureRecords(
    failedRecords,
    filters
  );
  const filteredControlRecords = filterAutomationFailureRecords(
    records,
    filters
  );
  const total = filteredFailedRecords.length;
  const pagedRecords = filteredFailedRecords.slice(
    (filters.page - 1) * filters.limit,
    filters.page * filters.limit
  );

  return NextResponse.json({
    summary: summarizeAutomationResilience(filteredControlRecords),
    breakdowns: buildAutomationFailureBreakdowns(filteredFailedRecords),
    filter_options: filterOptions,
    records: pagedRecords,
    total,
    page: filters.page,
    limit: filters.limit,
  });
}

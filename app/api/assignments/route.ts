import { NextResponse } from "next/server";
import { summarizeEntityDispatchEvents } from "@/lib/automation-dispatch";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUserId } from "@/lib/auth";
import { summarizeEntityJobRuns } from "@/lib/job-runs";

// Assignments no longer execute. They dispatched a run built straight from the
// agent row, so the run took `agents.model` with nothing able to override it —
// the second source of truth that the node-owns-the-model refactor deletes.
// Every automation is a flow now, where the node carries the model.
//
// GET/PUT/DELETE stay so an existing row can still be inspected, disabled, and
// removed. POST is gone: a new assignment would enqueue a job no consumer can
// route. Build the automation in the flow editor instead.
export async function POST() {
  return NextResponse.json(
    {
      error:
        "Assignments have been replaced by automations. Create a flow in the automations editor instead.",
    },
    { status: 410 }
  );
}

export async function GET() {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  // Get assignments for repos owned by this user
  const { data: repos } = await supabaseAdmin
    .from("repos")
    .select("id")
    .eq("user_id", userId);

  if (!repos?.length) return NextResponse.json([]);

  const repoIds = repos.map((r) => r.id);
  const { data, error } = await supabaseAdmin
    .from("assignments")
    .select("*")
    .in("repo_id", repoIds)
    .limit(500);

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json([]);

  const assignmentIds = data.map((assignment) => assignment.id);
  // Newest-first + capped: the summaries only consume recent runs/events, and
  // with PostgREST max_rows raised these queries must not fetch full history.
  const { data: jobRuns, error: jobRunsError } = await supabaseAdmin
    .from("job_runs")
    .select(
      "id, assignment_id, status, error, started_at, created_at, last_start_attempt_at"
    )
    .in("assignment_id", assignmentIds)
    .order("created_at", { ascending: false })
    .limit(10000);

  if (jobRunsError)
    return NextResponse.json({ error: jobRunsError.message }, { status: 500 });

  const { data: dispatchEvents, error: dispatchError } = await supabaseAdmin
    .from("automation_dispatch_events")
    .select("assignment_id, outcome, reason, created_at")
    .in("assignment_id", assignmentIds)
    .order("created_at", { ascending: false })
    .limit(10000);

  if (dispatchError)
    return NextResponse.json({ error: dispatchError.message }, { status: 500 });

  const summaries = new Map<
    string,
    ReturnType<typeof summarizeEntityJobRuns>
  >();
  const pressureSummaries = new Map<
    string,
    ReturnType<typeof summarizeEntityDispatchEvents>
  >();
  for (const assignment of data) {
    const runs = (jobRuns || []).filter(
      (run) => run.assignment_id === assignment.id
    );
    const events = (dispatchEvents || []).filter(
      (event) => event.assignment_id === assignment.id
    );
    summaries.set(assignment.id, summarizeEntityJobRuns(runs));
    pressureSummaries.set(assignment.id, summarizeEntityDispatchEvents(events));
  }

  return NextResponse.json(
    data.map((assignment) => ({
      ...assignment,
      ...(summaries.get(assignment.id) || summarizeEntityJobRuns([])),
      ...(pressureSummaries.get(assignment.id) ||
        summarizeEntityDispatchEvents([])),
    }))
  );
}

export async function PUT(req: Request) {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  const body = await req.json();
  const { id } = body;
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  // Whitelist allowed fields
  const updates: Record<string, unknown> = {};
  if (typeof body.enabled === "boolean") updates.enabled = body.enabled;
  if (typeof body.cron_schedule === "string")
    updates.cron_schedule = body.cron_schedule;
  if (
    typeof body.type === "string" &&
    [
      "pr_review",
      "cron_refactor",
      "cron",
      "push_review",
      "issue_triage",
      "ci_failure",
    ].includes(body.type)
  )
    updates.type = body.type;
  if (typeof body.skill_id === "string" || body.skill_id === null)
    updates.skill_id = body.skill_id;

  if (Object.keys(updates).length === 0)
    return NextResponse.json(
      { error: "No valid fields to update" },
      { status: 400 }
    );

  // Verify ownership via repo with a single joined query
  const { data: assignment } = await supabaseAdmin
    .from("assignments")
    .select("id, repo_id, repos!inner(user_id)")
    .eq("id", id)
    .eq("repos.user_id", userId)
    .single();

  if (!assignment)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data, error } = await supabaseAdmin
    .from("assignments")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: Request) {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  // Verify ownership via repo with a single joined query
  const { data: assignment } = await supabaseAdmin
    .from("assignments")
    .select("id, repo_id, repos!inner(user_id)")
    .eq("id", id)
    .eq("repos.user_id", userId)
    .single();

  if (!assignment)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { error } = await supabaseAdmin
    .from("assignments")
    .delete()
    .eq("id", assignment.id);

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

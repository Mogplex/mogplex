import { NextResponse } from "next/server";
import { summarizeEntityDispatchEvents } from "@/lib/automation-dispatch";
import { requireUserId } from "@/lib/auth";
import { summarizeEntityJobRuns } from "@/lib/job-runs";
import { supabaseAdmin } from "@/lib/supabase/admin";

type TriggerPostDeps = {
  requireUserId: typeof requireUserId;
  loadOwnedInstallation: (
    installationId: number,
    userId: string
  ) => Promise<{ id: string } | null>;
  loadOwnedAgent: (
    agentId: string,
    userId: string
  ) => Promise<{ id: string; name: string; slug: string | null } | null>;
  updateAgentSlug: (agentId: string, slug: string) => Promise<void>;
};

type TriggerPutDeps = {
  requireUserId: typeof requireUserId;
  loadOwnedAgent: (
    agentId: string,
    userId: string
  ) => Promise<{ id: string; name: string; slug: string | null } | null>;
  updateAgentSlug: (agentId: string, slug: string) => Promise<void>;
};

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\da-z]+/g, "-")
    .replace(/^-|-$/g, "");
}

const defaultTriggerAgentDeps = {
  async loadOwnedAgent(agentId: string, userId: string) {
    const { data, error } = await supabaseAdmin
      .from("agents")
      .select("id, name, slug")
      .eq("id", agentId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) throw new Error("Failed to load agent", { cause: error });
    return data;
  },
  async updateAgentSlug(agentId: string, slug: string) {
    const { error } = await supabaseAdmin
      .from("agents")
      .update({ slug })
      .eq("id", agentId);

    if (error) {
      throw new Error("Failed to update agent slug", { cause: error });
    }
  },
};

const defaultTriggerPostDeps: TriggerPostDeps = {
  requireUserId,
  async loadOwnedInstallation(installationId, userId) {
    const { data, error } = await supabaseAdmin
      .from("github_installations")
      .select("id")
      .eq("user_id", userId)
      .eq("installation_id", installationId)
      .maybeSingle();

    if (error) {
      throw new Error("Failed to load installation", { cause: error });
    }
    return data;
  },
  ...defaultTriggerAgentDeps,
};

const defaultTriggerPutDeps: TriggerPutDeps = {
  requireUserId,
  ...defaultTriggerAgentDeps,
};

async function resolveOwnedTriggerAgent(
  agentId: unknown,
  userId: string,
  deps: Pick<TriggerPostDeps, "loadOwnedAgent" | "updateAgentSlug">
) {
  if (typeof agentId !== "string" || agentId.trim().length === 0) {
    return NextResponse.json(
      { error: "agent_id is required" },
      { status: 400 }
    );
  }

  let agent: Awaited<ReturnType<TriggerPostDeps["loadOwnedAgent"]>>;
  try {
    agent = await deps.loadOwnedAgent(agentId, userId);
  } catch {
    return NextResponse.json(
      { error: "Failed to load agent" },
      { status: 500 }
    );
  }
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  if (!agent.slug) {
    try {
      await deps.updateAgentSlug(agent.id, slugify(agent.name));
    } catch {
      return NextResponse.json(
        { error: "Failed to prepare agent" },
        { status: 500 }
      );
    }
  }

  return agent.id;
}

export async function GET() {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  const { data: triggers, error } = await supabaseAdmin
    .from("triggers")
    .select("*, agents(id, name, slug, model)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  if (!triggers?.length) return NextResponse.json([]);

  const triggerIds = triggers.map((trigger) => trigger.id);
  // Newest-first + capped: the summaries only consume recent runs/events, and
  // with PostgREST max_rows raised these queries must not fetch full history.
  const { data: jobRuns, error: jobRunsError } = await supabaseAdmin
    .from("job_runs")
    .select(
      "id, trigger_id, status, error, started_at, created_at, last_start_attempt_at"
    )
    .in("trigger_id", triggerIds)
    .order("created_at", { ascending: false })
    .limit(10000);

  if (jobRunsError)
    return NextResponse.json({ error: jobRunsError.message }, { status: 500 });

  const { data: dispatchEvents, error: dispatchError } = await supabaseAdmin
    .from("automation_dispatch_events")
    .select("trigger_id, outcome, reason, created_at")
    .in("trigger_id", triggerIds)
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
  for (const trigger of triggers) {
    const runs = (jobRuns || []).filter((run) => run.trigger_id === trigger.id);
    const events = (dispatchEvents || []).filter(
      (event) => event.trigger_id === trigger.id
    );
    summaries.set(trigger.id, summarizeEntityJobRuns(runs));
    pressureSummaries.set(trigger.id, summarizeEntityDispatchEvents(events));
  }

  return NextResponse.json(
    triggers.map((trigger) => ({
      ...trigger,
      ...(summaries.get(trigger.id) || summarizeEntityJobRuns([])),
      ...(pressureSummaries.get(trigger.id) ||
        summarizeEntityDispatchEvents([])),
    }))
  );
}

export function createTriggersPostHandler(
  overrides: Partial<TriggerPostDeps> = {}
) {
  const deps: TriggerPostDeps = {
    ...defaultTriggerPostDeps,
    ...overrides,
  };

  return async function POST(request: Request) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const { installation_id, agent_id, event, is_default } = body;

    if (!installation_id || !agent_id || !event) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    let installation: Awaited<
      ReturnType<TriggerPostDeps["loadOwnedInstallation"]>
    >;
    try {
      installation = await deps.loadOwnedInstallation(installation_id, userId);
    } catch {
      return NextResponse.json(
        { error: "Failed to load installation" },
        { status: 500 }
      );
    }
    if (!installation) {
      return NextResponse.json(
        { error: "Installation not found" },
        { status: 404 }
      );
    }

    const resolvedAgentId = await resolveOwnedTriggerAgent(
      agent_id,
      userId,
      deps
    );
    if (resolvedAgentId instanceof Response) return resolvedAgentId;

    const { data: trigger, error } = await supabaseAdmin
      .from("triggers")
      .insert({
        user_id: userId,
        installation_id,
        agent_id: resolvedAgentId,
        event,
        is_default: is_default ?? false,
        enabled: true,
      })
      .select("*, agents(id, name, slug, model)")
      .single();

    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(trigger, { status: 201 });
  };
}

export const POST = createTriggersPostHandler();

export function createTriggersPutHandler(
  overrides: Partial<TriggerPutDeps> = {}
) {
  const deps: TriggerPutDeps = {
    ...defaultTriggerPutDeps,
    ...overrides,
  };

  return async function PUT(request: Request) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const { id, ...updates } = body;

    if (!id)
      return NextResponse.json(
        { error: "Missing trigger id" },
        { status: 400 }
      );

    // Only allow updating specific fields
    const allowed: Record<string, unknown> = {};
    if ("enabled" in updates) allowed.enabled = updates.enabled;
    if ("event" in updates) allowed.event = updates.event;
    if ("is_default" in updates) allowed.is_default = updates.is_default;
    if ("agent_id" in updates) {
      const resolvedAgentId = await resolveOwnedTriggerAgent(
        updates.agent_id,
        userId,
        deps
      );
      if (resolvedAgentId instanceof Response) return resolvedAgentId;
      allowed.agent_id = resolvedAgentId;
    }

    const { data, error } = await supabaseAdmin
      .from("triggers")
      .update(allowed)
      .eq("id", id)
      .eq("user_id", userId)
      .select("*, agents(id, name, slug, model)")
      .single();

    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  };
}

export const PUT = createTriggersPutHandler();

export async function DELETE(request: Request) {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const { error } = await supabaseAdmin
    .from("triggers")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

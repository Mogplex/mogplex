import {
  presentMogplexApiRunEvent,
  type PresentedAiCallEvent,
} from "@/lib/mogplex-api/run-control";
import {
  presentMogplexApiRun,
  type ExternalAgentRunRow,
  type MogplexApiRunDetail,
} from "@/lib/mogplex-api/runs";
import type { AiCallEvent } from "@/lib/types";

export type MogplexApiRunEventCursor = {
  id: string;
  createdAt: string;
};

export type MogplexApiRunEventStreamContext = {
  run: MogplexApiRunDetail;
  aiCallId: string;
  cursor: MogplexApiRunEventCursor | null;
};

export type MogplexApiRunEventPage = {
  events: PresentedAiCallEvent[];
  cursor: MogplexApiRunEventCursor | null;
  hasMore: boolean;
};

export class MogplexApiRunEventCursorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MogplexApiRunEventCursorError";
  }
}

async function getSupabaseAdmin() {
  const mod = await import("@/lib/supabase/admin");
  return mod.supabaseAdmin;
}

function eventCursor(event: AiCallEvent): MogplexApiRunEventCursor {
  return { id: event.id, createdAt: event.created_at };
}

export async function loadMogplexApiRunEventStreamContext(input: {
  userId: string;
  runId: string;
  lastEventId: string | null;
}): Promise<MogplexApiRunEventStreamContext | null> {
  const supabaseAdmin = await getSupabaseAdmin();
  const { data: run, error: runError } = await supabaseAdmin
    .from("external_agent_runs")
    .select("*")
    .eq("id", input.runId)
    .eq("user_id", input.userId)
    .maybeSingle();

  if (runError) {
    throw new Error(`Failed to load external agent run: ${runError.message}`);
  }
  if (!run) return null;
  const typedRun = run as ExternalAgentRunRow;

  let cursor: MogplexApiRunEventCursor | null = null;
  if (input.lastEventId) {
    const { data: event, error: eventError } = await supabaseAdmin
      .from("ai_call_events")
      .select("id, created_at")
      .eq("id", input.lastEventId)
      .eq("ai_call_id", typedRun.ai_call_id)
      .eq("user_id", input.userId)
      .maybeSingle();
    if (eventError) {
      throw new Error(`Failed to load run event cursor: ${eventError.message}`);
    }
    if (!event) {
      throw new MogplexApiRunEventCursorError(
        "Last-Event-ID does not belong to this run"
      );
    }
    cursor = { id: event.id, createdAt: event.created_at };
  }

  return {
    run: presentMogplexApiRun(typedRun),
    aiCallId: typedRun.ai_call_id,
    cursor,
  };
}

export async function listMogplexApiRunEventPage(input: {
  userId: string;
  aiCallId: string;
  cursor: MogplexApiRunEventCursor | null;
  limit: number;
  latest: boolean;
}): Promise<MogplexApiRunEventPage> {
  const supabaseAdmin = await getSupabaseAdmin();
  let query = supabaseAdmin
    .from("ai_call_events")
    .select("*")
    .eq("ai_call_id", input.aiCallId)
    .eq("user_id", input.userId);

  if (input.latest) {
    query = query
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(input.limit);
  } else {
    query = query
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(input.limit + 1);
    if (input.cursor) {
      query = query.or(
        `created_at.gt.${input.cursor.createdAt},and(created_at.eq.${input.cursor.createdAt},id.gt.${input.cursor.id})`
      );
    }
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to list run event page: ${error.message}`);
  }

  const rows = (data ?? []) as AiCallEvent[];
  const pageRows = input.latest
    ? rows.slice().reverse()
    : rows.slice(0, input.limit);
  return {
    events: pageRows.map(presentMogplexApiRunEvent),
    cursor: pageRows.at(-1) ? eventCursor(pageRows.at(-1)!) : input.cursor,
    hasMore: !input.latest && rows.length > input.limit,
  };
}

export async function loadMogplexApiRunEvent(input: {
  userId: string;
  aiCallId: string;
  eventId: string;
}) {
  const supabaseAdmin = await getSupabaseAdmin();
  const { data: event, error } = await supabaseAdmin
    .from("ai_call_events")
    .select("*")
    .eq("id", input.eventId)
    .eq("ai_call_id", input.aiCallId)
    .eq("user_id", input.userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load run event: ${error.message}`);
  }
  return event ? presentMogplexApiRunEvent(event as AiCallEvent) : null;
}

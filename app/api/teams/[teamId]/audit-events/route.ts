import { NextResponse } from "next/server";
import { requireProfileId } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { loadTeamMembershipAuth } from "@/lib/team-management";
import type { TeamAuditPayload } from "@/lib/team-audit";

const PAGE_SIZE = 25;
const MAX_UUID_CURSOR = "ffffffff-ffff-ffff-ffff-ffffffffffff";
const ISO_CURSOR_DATE_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

export type TeamAuditEvent = {
  id: string;
  action: string;
  decisionCode: string | null;
  targetType: string;
  targetId: string | null;
  actorUserId: string | null;
  repoId: string | null;
  sandboxRecordId: string | null;
  aiCallId: string | null;
  jobRunId: string | null;
  requestId: string | null;
  authSource: string | null;
  payload: TeamAuditPayload;
  createdAt: string;
};

export type TeamAuditEventsResponse = {
  events: TeamAuditEvent[];
  nextCursor: string | null;
  viewer: { canManage: boolean };
};

type AuditRow = {
  id: string;
  action: string;
  decision_code: string | null;
  target_type: string;
  target_id: string | null;
  actor_user_id: string | null;
  repo_id: string | null;
  sandbox_record_id: string | null;
  ai_call_id: string | null;
  job_run_id: string | null;
  request_id: string | null;
  auth_source: string | null;
  payload: TeamAuditPayload;
  created_at: string;
};

export type AuditCursor = {
  createdAt: string;
  id: string;
};

type AuditEventsRouteDeps = {
  requireProfileId: typeof requireProfileId;
  loadTeamMembershipAuth: typeof loadTeamMembershipAuth;
  listAuditEvents: (
    teamId: string,
    cursor: AuditCursor | null
  ) => Promise<{ data: AuditRow[] | null; error: { message: string } | null }>;
  logError: (message: string, error: { message: string }) => void;
};

const defaultAuditEventsRouteDeps: AuditEventsRouteDeps = {
  requireProfileId,
  loadTeamMembershipAuth,
  async listAuditEvents(teamId, cursor) {
    let query = supabaseAdmin
      .from("team_audit_events")
      .select(
        "id, action, decision_code, target_type, target_id, actor_user_id, repo_id, sandbox_record_id, ai_call_id, job_run_id, request_id, auth_source, payload, created_at"
      )
      .eq("team_id", teamId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(PAGE_SIZE + 1);

    if (cursor) {
      query = query.or(
        `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`
      );
    }

    const { data, error } = await query;
    return {
      data: data as AuditRow[] | null,
      error: error ? { message: error.message } : null,
    };
  },
  logError(message, error) {
    console.error(message, error);
  },
};

function isValidCursorId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
      value
    )
  );
}

function isValidCursorDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    ISO_CURSOR_DATE_PATTERN.test(value) &&
    !Number.isNaN(new Date(value).getTime())
  );
}

export function encodeAuditCursor(row: Pick<AuditRow, "created_at" | "id">) {
  return Buffer.from(
    JSON.stringify({ createdAt: row.created_at, id: row.id }),
    "utf8"
  ).toString("base64url");
}

function readCursor(request: Request) {
  const raw = new URL(request.url).searchParams.get("cursor");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8")
    ) as {
      createdAt?: unknown;
      id?: unknown;
    };
    if (isValidCursorDate(parsed.createdAt) && isValidCursorId(parsed.id)) {
      return { createdAt: parsed.createdAt, id: parsed.id };
    }
    // Parsed composite cursors must match the current strict shape. The
    // fallback below is only for pre-opaque raw timestamp cursors.
    return undefined;
  } catch {
    // Older callers may still send the pre-opaque timestamp cursor. Accept it
    // as a best-effort fallback while new responses use the stable composite
    // cursor shape.
    return isValidCursorDate(raw)
      ? { createdAt: raw, id: MAX_UUID_CURSOR }
      : undefined;
  }
}

function toAuditEvent(row: AuditRow): TeamAuditEvent {
  return {
    id: row.id,
    action: row.action,
    decisionCode: row.decision_code,
    targetType: row.target_type,
    targetId: row.target_id,
    actorUserId: row.actor_user_id,
    repoId: row.repo_id,
    sandboxRecordId: row.sandbox_record_id,
    aiCallId: row.ai_call_id,
    jobRunId: row.job_run_id,
    requestId: row.request_id,
    authSource: row.auth_source,
    payload: row.payload ?? {},
    createdAt: row.created_at,
  };
}

export function createTeamAuditEventsGetHandler(
  overrides: Partial<AuditEventsRouteDeps> = {}
) {
  const deps: AuditEventsRouteDeps = {
    ...defaultAuditEventsRouteDeps,
    ...overrides,
  };

  return async function GET(
    request: Request,
    context: { params: Promise<{ teamId: string }> }
  ) {
    const profileId = await deps.requireProfileId();
    if (profileId instanceof Response) return profileId;

    const cursor = readCursor(request);
    if (cursor === undefined) {
      return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
    }

    const { teamId } = await context.params;
    const auth = await deps.loadTeamMembershipAuth(teamId, profileId);
    if (!auth.ok) {
      if (auth.status === 500) {
        return NextResponse.json(
          { error: "Internal server error" },
          { status: 500 }
        );
      }
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    if (!auth.canManage) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data, error } = await deps.listAuditEvents(teamId, cursor);
    if (error) {
      deps.logError("Audit events query failed", error);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }

    const rows = data ?? [];
    const pageRows = rows.slice(0, PAGE_SIZE);
    const nextCursor =
      rows.length > PAGE_SIZE && pageRows.at(-1)
        ? encodeAuditCursor(pageRows.at(-1)!)
        : null;

    return NextResponse.json<TeamAuditEventsResponse>({
      events: pageRows.map(toAuditEvent),
      nextCursor,
      viewer: { canManage: true },
    });
  };
}

export const GET = createTeamAuditEventsGetHandler();

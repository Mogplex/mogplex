export type TeamAuditPayload = Record<string, unknown>;

export type RecordTeamAuditEventInput = {
  productTeamId: string;
  actorUserId?: string | null;
  actorMemberId?: string | null;
  action: string;
  decisionCode?: string | null;
  targetType: string;
  targetId?: string | null;
  correlations?: {
    repoId?: string | null;
    sandboxRecordId?: string | null;
    aiCallId?: string | null;
    jobRunId?: string | null;
    requestId?: string | null;
    authSource?: string | null;
  };
  payload?: TeamAuditPayload;
};

export type TeamAuditInsert = {
  team_id: string;
  actor_user_id: string | null;
  actor_member_id: string | null;
  action: string;
  decision_code: string | null;
  target_type: string;
  target_id: string | null;
  repo_id: string | null;
  sandbox_record_id: string | null;
  ai_call_id: string | null;
  job_run_id: string | null;
  request_id: string | null;
  auth_source: string | null;
  payload: TeamAuditPayload;
};

export type TeamAuditWriteResult = { ok: true } | { ok: false; error: string };

type RecordTeamAuditDeps = {
  loadActorMemberId: (
    teamId: string,
    actorUserId: string
  ) => Promise<string | null>;
  insertAuditEvent: (
    row: TeamAuditInsert
  ) => Promise<{ error: { message: string } | null }>;
  logError: (message: string, error: unknown) => void;
};

const REDACTED = "[redacted]";
const MAX_PAYLOAD_DEPTH = 6;
const UNSAFE_KEY_PATTERN =
  /(api[_-]?key|authorization|credential|password|provider[_-]?key|prompt|secret|token)/i;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth > MAX_PAYLOAD_DEPTH) return "[truncated]";
  if (value === null) return null;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, depth + 1));
  }
  if (isPlainRecord(value)) {
    return sanitizeTeamAuditPayload(value, depth + 1);
  }
  return String(value);
}

export function sanitizeTeamAuditPayload(
  payload: Record<string, unknown>,
  depth = 0
): TeamAuditPayload {
  const sanitized: TeamAuditPayload = {};
  for (const [key, value] of Object.entries(payload)) {
    sanitized[key] = UNSAFE_KEY_PATTERN.test(key)
      ? REDACTED
      : sanitizeValue(value, depth);
  }
  return sanitized;
}

async function defaultLoadActorMemberId(teamId: string, actorUserId: string) {
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  const { data, error } = await supabaseAdmin
    .from("team_members")
    .select("id")
    .eq("team_id", teamId)
    .eq("user_id", actorUserId)
    .maybeSingle();

  if (error || !data) return null;
  return (data as { id: string }).id;
}

const defaultRecordTeamAuditDeps: RecordTeamAuditDeps = {
  loadActorMemberId: defaultLoadActorMemberId,
  async insertAuditEvent(row) {
    const { supabaseAdmin } = await import("@/lib/supabase/admin");
    const { error } = await supabaseAdmin.from("team_audit_events").insert(row);
    return { error: error ? { message: error.message } : null };
  },
  logError(message, error) {
    console.error(message, error);
  },
};

export function createRecordTeamAuditEvent(
  overrides: Partial<RecordTeamAuditDeps> = {}
) {
  const deps: RecordTeamAuditDeps = {
    ...defaultRecordTeamAuditDeps,
    ...overrides,
  };

  return async function recordTeamAuditEvent(
    input: RecordTeamAuditEventInput
  ): Promise<TeamAuditWriteResult> {
    try {
      const actorMemberId =
        input.actorMemberId ??
        (input.actorUserId
          ? await deps.loadActorMemberId(input.productTeamId, input.actorUserId)
          : null);
      const row: TeamAuditInsert = {
        team_id: input.productTeamId,
        actor_user_id: input.actorUserId ?? null,
        actor_member_id: actorMemberId,
        action: input.action,
        decision_code: input.decisionCode ?? null,
        target_type: input.targetType,
        target_id: input.targetId ?? null,
        repo_id: input.correlations?.repoId ?? null,
        sandbox_record_id: input.correlations?.sandboxRecordId ?? null,
        ai_call_id: input.correlations?.aiCallId ?? null,
        job_run_id: input.correlations?.jobRunId ?? null,
        request_id: input.correlations?.requestId ?? null,
        auth_source: input.correlations?.authSource ?? null,
        payload: sanitizeTeamAuditPayload(input.payload ?? {}),
      };

      const { error } = await deps.insertAuditEvent(row);
      if (error) {
        deps.logError("[team-audit] failed to insert audit event", error);
        return { ok: false, error: error.message };
      }
      return { ok: true };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown audit write failure";
      deps.logError("[team-audit] failed to record audit event", error);
      return { ok: false, error: message };
    }
  };
}

export const recordTeamAuditEvent = createRecordTeamAuditEvent();

export function deferTeamAuditEvent(
  record: (input: RecordTeamAuditEventInput) => Promise<TeamAuditWriteResult>,
  input: RecordTeamAuditEventInput
) {
  void record(input).catch((error) => {
    console.error("[team-audit] unexpected deferred audit failure", error);
  });
}

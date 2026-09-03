const ERROR_KEY_PATTERN =
  /(?:^|_)(?:error|errors|exception|stack|stacktrace|stderr|failure|failure_message|last_start_error|cancel_error)(?:$|_)/i;

const ENV_CONFIGURATION_PATTERN =
  /\b[A-Z][A-Z0-9_]{2,}\b.{0,80}\b(?:required|missing|unset|not configured)\b/i;
const STACK_TRACE_PATTERN = /(?:^|\n)\s*at\s+[^\n]+(?:\(|:\d+:\d+)/m;
const INTERNAL_URL_PATTERN =
  /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|[^\s/]+\.(?:internal|local))(?:[/:\s]|$)/i;
const INTERNAL_PROVIDER_PATTERN =
  /\b(?:postgres|postgrest|database|supabase|neon|stripe|vercel|trigger\.dev)\b.{0,100}\b(?:error|failed|failure|unavailable|denied|timeout)\b/i;
// This exact prefix is authored by Mogplex after it checks the user's billing
// account, before any provider request. Keep the match narrow: an upstream AI
// Gateway balance error is a platform diagnostic and must remain internal.
const MOGPLEX_AI_CREDIT_REQUIRED_PATTERN =
  /^(?:Automation model configuration failed:\s*)?Hosted AI requires a positive billing balance\./i;
const FAILURE_SIGNAL_PATTERN =
  /\b(?:error|failed|failure|exception|invalid|unavailable|denied|timeout|timed out|429|rate limit|cancelled|canceled|aborted)\b/i;
const FAILURE_STATE_PATTERN =
  /^(?:failed|failure|start_failed|cancel_failed|error|errored)$/i;
const SAFE_MACHINE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,80}$/;
// Failure classes are a closed vocabulary shared with the automation
// pipeline; they must survive sanitization or the failure-class filters and
// labels in the observability UI stop working on exactly the runs they exist
// for.
const SAFE_FAILURE_CLASS_VALUES = new Set([
  "authentication",
  "authorization",
  "cancelled",
  "canceled",
  "configuration",
  "dependency_unavailable",
  "internal",
  "provider_unavailable",
  "rate_limited",
  "timeout",
  "unknown",
]);
const SAFE_FAILURE_FIELDS = new Set([
  "id",
  "status",
  "state",
  "type",
  "event_type",
  "event_kind",
  "outcome",
  "source",
  "source_kind",
  "source_type",
  "model",
  "name",
  "slug",
  "path",
  "line",
  "severity",
  "branch",
  "harness",
  "review_dedup_key",
]);
// Dispatch context recorded before a run fails (PR refs, shas, titles, repo
// names) carries no diagnostics; wiping it made failed runs render as if the
// error had been copied into every metadata field.
const SAFE_FAILURE_FIELD_SUFFIX_PATTERN =
  /_(?:id|type|at|ref|sha|title|author|login|full_name|label|provider|phase|source|branch)$/;
const FAILURE_CONTEXT_RESET_KEYS = new Set([
  "agent",
  "ai_calls",
  "dispatch_events",
  "events",
  "latest_ai_call",
  "latest_dispatch_event",
  "node_runs",
  "repo",
  "review_findings",
  "sandbox_context",
  "tool_calls",
  "input",
  "input_preview",
  "prompt",
]);

type FailureKind =
  | "billing"
  | "cancelled"
  | "timeout"
  | "rate_limit"
  | "authorization"
  | "configuration"
  | "internal";

function normalizeIncidentPart(value: string) {
  const normalized = value.replace(/[^a-z0-9]/gi, "").toUpperCase();
  return normalized.slice(0, 10) || "UNKNOWN";
}

export function buildObservabilityIncidentId(
  entityKind: string,
  entityId: string
) {
  return `MOG-${normalizeIncidentPart(entityKind)}-${normalizeIncidentPart(entityId)}`;
}

function classifyFailure(raw: string): FailureKind {
  if (MOGPLEX_AI_CREDIT_REQUIRED_PATTERN.test(raw)) {
    return "billing";
  }
  if (/\b(?:cancelled|canceled|cancel requested|aborted)\b/i.test(raw)) {
    return "cancelled";
  }
  if (/\b(?:timeout|timed out|deadline|time limit)\b/i.test(raw)) {
    return "timeout";
  }
  if (/\b(?:429|rate limit|quota|too many requests)\b/i.test(raw)) {
    return "rate_limit";
  }
  if (
    /\b(?:unauthorized|forbidden|permission|access denied|not installed|reconnect)\b/i.test(
      raw
    )
  ) {
    return "authorization";
  }
  if (
    ENV_CONFIGURATION_PATTERN.test(raw) ||
    /\b(?:model|provider|credential|api key|configuration|configured)\b.{0,80}\b(?:missing|required|invalid|unavailable|not configured)\b/i.test(
      raw
    )
  ) {
    return "configuration";
  }
  return "internal";
}

export function presentObservabilityFailure(raw: unknown, incidentId: string) {
  const text = typeof raw === "string" ? raw : "";
  switch (classifyFailure(text)) {
    case "billing":
      return "This Mogplex account cannot use hosted AI because it has no credit. Add funds or choose a plan in Settings > Billing. Or add an AI Gateway or provider key in Settings > API Keys.";
    case "cancelled":
      return `The run was cancelled before it completed. Incident ${incidentId}.`;
    case "timeout":
      return `The run exceeded its time limit. Retry it or reduce the task scope. Incident ${incidentId}.`;
    case "rate_limit":
      return `The AI provider rate limit or quota was reached. Retry later or check provider usage. Incident ${incidentId}.`;
    case "authorization":
      return `A required connection is not authorized. Reconnect it in Settings and retry. Incident ${incidentId}.`;
    case "configuration":
      return `This run needs additional model or provider configuration. Check Settings and retry. Incident ${incidentId}.`;
    case "internal":
      return `The run failed because of an internal service error. Retry it; if it continues, contact support with incident ${incidentId}.`;
  }
}

function looksLikeInternalDiagnostic(value: string) {
  return (
    ENV_CONFIGURATION_PATTERN.test(value) ||
    STACK_TRACE_PATTERN.test(value) ||
    INTERNAL_URL_PATTERN.test(value) ||
    INTERNAL_PROVIDER_PATTERN.test(value)
  );
}

function isSafeFailureField(key: string) {
  const normalized = key.toLowerCase();
  return (
    SAFE_FAILURE_FIELDS.has(normalized) ||
    SAFE_FAILURE_FIELD_SUFFIX_PATTERN.test(normalized)
  );
}

// Keys whose values are enum-style codes by contract (dispatch reasons,
// review outcomes, failure classes). Value shape alone is NOT proof of
// benignity — AWS access key IDs and bare env-var names match
// SAFE_MACHINE_CODE_PATTERN too — so the passthrough is scoped to these keys.
const FAILURE_ENUM_KEY_PATTERN = /(?:^|_)(?:reason|code|outcome|class)$/;

// In failure context, unknown string fields fail closed — but values that are
// provably not prose diagnostics (enum codes under enum-carrying keys, links
// to public GitHub pages) stay readable so the operator can tell WHAT failed.
function isBenignFailureValue(key: string | undefined, value: string) {
  if (key == null) return false;
  const normalized = key.toLowerCase();
  if (FAILURE_ENUM_KEY_PATTERN.test(normalized)) {
    return (
      SAFE_FAILURE_CLASS_VALUES.has(value) ||
      SAFE_MACHINE_CODE_PATTERN.test(value)
    );
  }
  return normalized.endsWith("_url") && value.startsWith("https://github.com/");
}

function sanitizeStringValue(
  value: string,
  incidentId: string,
  parentKey?: string,
  failureContext = false
) {
  if (
    parentKey &&
    /(?:^|_)(?:code|error_code)(?:$|_)/i.test(parentKey) &&
    SAFE_MACHINE_CODE_PATTERN.test(value)
  ) {
    return value;
  }
  if (parentKey && ERROR_KEY_PATTERN.test(parentKey)) {
    return SAFE_FAILURE_CLASS_VALUES.has(value)
      ? value
      : presentObservabilityFailure(value, incidentId);
  }
  if (looksLikeInternalDiagnostic(value)) {
    return presentObservabilityFailure(value, incidentId);
  }
  if (failureContext && (!parentKey || !isSafeFailureField(parentKey))) {
    return isBenignFailureValue(parentKey, value)
      ? value
      : presentObservabilityFailure(value, incidentId);
  }
  return value;
}

function sanitizeValue(
  value: unknown,
  incidentId: string,
  entityKind: string,
  parentKey?: string,
  failureContext = false
): unknown {
  if (typeof value === "string") {
    return sanitizeStringValue(value, incidentId, parentKey, failureContext);
  }
  if (Array.isArray(value)) {
    return value.map((entry) =>
      sanitizeValue(entry, incidentId, entityKind, parentKey, failureContext)
    );
  }
  if (!value || typeof value !== "object") return value;

  const record = value as Record<string, unknown>;
  const childIncidentId =
    typeof record.id === "string"
      ? buildObservabilityIncidentId(entityKind, record.id)
      : incidentId;
  const recordFailureContext =
    failureContext ||
    (Boolean(parentKey) && ERROR_KEY_PATTERN.test(parentKey ?? "")) ||
    [record.status, record.state, record.outcome, record.event_type].some(
      (candidate) =>
        typeof candidate === "string" && FAILURE_STATE_PATTERN.test(candidate)
    );
  return Object.fromEntries(
    Object.entries(record).map(([key, entry]) => [
      key,
      sanitizeValue(
        entry,
        childIncidentId,
        entityKind,
        key,
        recordFailureContext && !FAILURE_CONTEXT_RESET_KEYS.has(key)
      ),
    ])
  );
}

export function sanitizeObservabilityPayload<T>(
  value: T,
  entityKind: string,
  entityId: string
): T {
  return sanitizeValue(
    value,
    buildObservabilityIncidentId(entityKind, entityId),
    entityKind
  ) as T;
}

export function sanitizeObservabilityEvent<T extends Record<string, unknown>>(
  event: T
): T {
  const incidentId = buildObservabilityIncidentId(
    "EVENT",
    typeof event.id === "string" ? event.id : "unknown"
  );
  const sanitized = sanitizeValue(event, incidentId, "EVENT") as T;
  if (
    typeof event.message === "string" &&
    (event.event_type === "failed" ||
      (event.event_type === "log" &&
        looksLikeInternalDiagnostic(event.message)))
  ) {
    (sanitized as Record<string, unknown>).message =
      presentObservabilityFailure(event.message, incidentId) as T["message"];
  }
  return sanitized;
}

export function sanitizeObservabilityToolEntry<
  T extends Record<string, unknown>,
>(entry: T): T {
  const incidentId = buildObservabilityIncidentId(
    "TOOL",
    typeof entry.id === "string" ? entry.id : "unknown"
  );
  const sanitized = sanitizeValue(entry, incidentId, "TOOL") as T;
  for (const key of ["output", "output_preview"] as const) {
    const original = entry[key];
    if (
      typeof original === "string" &&
      (looksLikeInternalDiagnostic(original) ||
        FAILURE_SIGNAL_PATTERN.test(original))
    ) {
      (sanitized as Record<string, unknown>)[key] = presentObservabilityFailure(
        original,
        incidentId
      );
    }
  }
  return sanitized;
}

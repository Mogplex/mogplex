const ERROR_KEY_PATTERN =
  /(?:^|_)(?:error|errors|exception|stack|stacktrace|stderr|failure|failure_message|last_start_error|cancel_error)(?:$|_)/i;
const DIAGNOSTIC_MESSAGE_KEY_PATTERN = /(?:^|_)(?:message|reason)(?:$|_)/i;

const ENV_CONFIGURATION_PATTERN =
  /\b[A-Z][A-Z0-9_]{2,}\b.{0,80}\b(?:required|missing|unset|not configured)\b/i;
const STACK_TRACE_PATTERN = /(?:^|\n)\s*at\s+[^\n]+(?:\(|:\d+:\d+)/m;
const INTERNAL_URL_PATTERN =
  /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|[^\s/]+\.(?:internal|local))(?:[/:\s]|$)/i;
const INTERNAL_PROVIDER_PATTERN =
  /\b(?:postgres|postgrest|database|supabase|neon|stripe|vercel|trigger\.dev)\b.{0,100}\b(?:error|failed|failure|unavailable|denied|timeout)\b/i;
const FAILURE_SIGNAL_PATTERN =
  /\b(?:error|failed|failure|exception|invalid|unavailable|denied|timeout|timed out|429|rate limit|cancelled|canceled|aborted)\b/i;

type FailureKind =
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

function sanitizeValue(
  value: unknown,
  incidentId: string,
  parentKey?: string
): unknown {
  if (typeof value === "string") {
    if (
      (parentKey && ERROR_KEY_PATTERN.test(parentKey)) ||
      (parentKey &&
        DIAGNOSTIC_MESSAGE_KEY_PATTERN.test(parentKey) &&
        FAILURE_SIGNAL_PATTERN.test(value)) ||
      looksLikeInternalDiagnostic(value)
    ) {
      return presentObservabilityFailure(value, incidentId);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry, incidentId, parentKey));
  }
  if (!value || typeof value !== "object") return value;

  const record = value as Record<string, unknown>;
  const childIncidentId =
    typeof record.id === "string"
      ? buildObservabilityIncidentId("RUN", record.id)
      : incidentId;
  return Object.fromEntries(
    Object.entries(record).map(([key, entry]) => [
      key,
      sanitizeValue(entry, childIncidentId, key),
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
    buildObservabilityIncidentId(entityKind, entityId)
  ) as T;
}

export function sanitizeObservabilityEvent<T extends Record<string, unknown>>(
  event: T
): T {
  const incidentId = buildObservabilityIncidentId(
    "EVENT",
    typeof event.id === "string" ? event.id : "unknown"
  );
  const sanitized = sanitizeValue(event, incidentId) as T;
  if (
    typeof event.message === "string" &&
    (event.event_type === "failed" ||
      (event.event_type === "log" &&
        (looksLikeInternalDiagnostic(event.message) ||
          classifyFailure(event.message) !== "internal")))
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
  const sanitized = sanitizeValue(entry, incidentId) as T;
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

const DEFAULT_MAX_STRING_LENGTH = 40_000;
const DEFAULT_MAX_ITEMS = 50;
const DEFAULT_MAX_DEPTH = 4;
const MAX_REDACTION_DEPTH = 20;
const REDACTED_VALUE = "[redacted]";

const SENSITIVE_KEY_TERMS = [
  "authorization",
  "api_key",
  "apikey",
  "token",
  "secret",
  "password",
  "passwd",
  "cookie",
  "credential",
  "client_secret",
  "clientsecret",
  "access_token",
  "accesstoken",
  "refresh_token",
  "refreshtoken",
  "session",
  "jwt",
  "private_key",
  "privatekey",
  "access_key_id",
  "accesskeyid",
] as const;
const TEXT_ASSIGNMENT_PATTERN =
  /\b([a-z][a-z0-9_-]*)(["']?\s*[:=]\s*)(?!\[redacted\])("[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gi;

type TelemetrySanitizeOptions = {
  maxStringLength?: number;
  maxItems?: number;
  maxDepth?: number;
};

function isSensitiveKey(key: string) {
  const normalized = key.toLowerCase().replaceAll("-", "_");
  return SENSITIVE_KEY_TERMS.some((term) => normalized.includes(term));
}

function truncateTelemetryString(value: string, maxStringLength: number) {
  if (value.length <= maxStringLength) return value;
  return `${value.slice(0, maxStringLength)}\n...[truncated ${value.length - maxStringLength} chars]`;
}

function maybeRedactJsonString(
  value: string,
  options: Required<TelemetrySanitizeOptions>
) {
  const trimmed = value.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return null;

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    return JSON.stringify(sanitizeTelemetryValue(parsed, options));
  } catch {
    return null;
  }
}

export function redactSecretsInText(value: string) {
  return value
    .replace(
      /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
      REDACTED_VALUE
    )
    .replace(
      /\b([a-z][a-z0-9+.-]*:\/\/)(?!x-access-token:)[^\s/:@]+:[^\s/@]+@/gi,
      "$1[redacted]:[redacted]@"
    )
    .replace(/(x-access-token:)[^\s@]+@/gi, "$1[redacted]@")
    .replace(
      /\bauthorization\s*[:=]\s*((?:basic|bearer)\s+)?[^\s,;]+/gi,
      (_match, scheme = "") => `Authorization: ${scheme}[redacted]`
    )
    .replace(TEXT_ASSIGNMENT_PATTERN, (match, key, separator) =>
      key.toLowerCase().includes("authorization")
        ? match
        : isSensitiveKey(key)
          ? `${key}${separator}[redacted]`
          : match
    )
    .replace(
      /([?&](?:api[_-]?key|token|secret|password|credential|access[_-]?token)=)[^&#\s]+/gi,
      "$1[redacted]"
    )
    .replace(
      /\b(?:eyJ[A-Za-z0-9_-]{8,}\.){2}[A-Za-z0-9_-]{8,}\b/g,
      REDACTED_VALUE
    )
    .replace(/\b(?:AKIA|ASIA|AIDA|AROA)[A-Z0-9]{16}\b/g, REDACTED_VALUE)
    .replace(
      /\b(?:password|secret|credential|token)\s+(?:is|value)\s*[:=]?\s*[^\s,;]+/gi,
      REDACTED_VALUE
    )
    .replace(/\bbearer\s+[\w+./=~-]+\b/gi, "Bearer [redacted]")
    .replace(/\b(?:gh[oprsu]_\w+|github_pat_\w+)\b/g, REDACTED_VALUE)
    .replace(/\bsk-[\w-]{8,}\b/g, REDACTED_VALUE)
    .replace(
      /\b(?:xox[baprs]-|sk_live_|rk_live_|AIza)[A-Za-z0-9_-]{8,}\b/g,
      REDACTED_VALUE
    )
    .replace(/\bsb_secret_[\w-]+\b/g, REDACTED_VALUE);
}

function redactStringSecrets(
  value: string,
  options: Required<TelemetrySanitizeOptions>
) {
  const jsonRedacted = maybeRedactJsonString(value, options);
  const redacted = redactSecretsInText(jsonRedacted ?? value);

  return truncateTelemetryString(redacted, options.maxStringLength);
}

/** Redact secrets while preserving ordinary display strings. */
export function redactSecretsInValue(value: unknown): unknown {
  return redactSecretsInValueInternal(value, 0);
}

function redactSecretsInValueInternal(value: unknown, depth: number): unknown {
  if (typeof value === "string") return redactSecretsInText(value);
  if (value === null || typeof value === "number" || typeof value === "boolean")
    return value;
  if (depth >= MAX_REDACTION_DEPTH && typeof value === "object") {
    return "[truncated]";
  }
  if (Array.isArray(value)) {
    return value.map((nested) =>
      redactSecretsInValueInternal(nested, depth + 1)
    );
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        isSensitiveKey(key)
          ? REDACTED_VALUE
          : redactSecretsInValueInternal(nested, depth + 1),
      ])
    );
  }
  return value;
}

function resolveOptions(
  options?: TelemetrySanitizeOptions
): Required<TelemetrySanitizeOptions> {
  return {
    maxStringLength: options?.maxStringLength ?? DEFAULT_MAX_STRING_LENGTH,
    maxItems: options?.maxItems ?? DEFAULT_MAX_ITEMS,
    maxDepth: options?.maxDepth ?? DEFAULT_MAX_DEPTH,
  };
}

export function sanitizeTelemetryValue(
  value: unknown,
  options?: TelemetrySanitizeOptions
): unknown {
  const resolved = resolveOptions(options);
  return sanitizeTelemetryValueInternal(value, resolved, 0);
}

function sanitizeTelemetryValueInternal(
  value: unknown,
  options: Required<TelemetrySanitizeOptions>,
  depth: number
): unknown {
  if (typeof value === "string") return redactStringSecrets(value, options);
  if (value === null || typeof value === "number" || typeof value === "boolean")
    return value;

  if (depth >= options.maxDepth) {
    return typeof value === "object" ? "[truncated]" : String(value);
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, options.maxItems)
      .map((entry) =>
        sanitizeTelemetryValueInternal(entry, options, depth + 1)
      );
  }

  if (typeof value === "object") {
    const entries = Object.entries(value)
      .slice(0, options.maxItems)
      .map(([key, nested]) =>
        isSensitiveKey(key)
          ? ([key, REDACTED_VALUE] as const)
          : ([
              key,
              sanitizeTelemetryValueInternal(nested, options, depth + 1),
            ] as const)
      )
      .filter(([, nested]) => nested !== undefined);

    return Object.fromEntries(entries);
  }

  if (value === undefined) return undefined;
  return String(value);
}

export function sanitizeTelemetryRecord(
  payload?: Record<string, unknown>,
  options?: TelemetrySanitizeOptions
): Record<string, unknown> {
  const sanitized = sanitizeTelemetryValue(payload ?? {}, options);
  if (!sanitized || typeof sanitized !== "object" || Array.isArray(sanitized)) {
    return {};
  }

  return sanitized as Record<string, unknown>;
}

export function previewTelemetryValue(value: unknown) {
  if (value === undefined) return;
  if (typeof value === "string") return value.slice(0, 200);

  try {
    return JSON.stringify(value).slice(0, 200);
  } catch {
    return "[unserializable]";
  }
}

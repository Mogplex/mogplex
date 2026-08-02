const DEFAULT_MAX_STRING_LENGTH = 40_000;
const DEFAULT_MAX_ITEMS = 50;
const DEFAULT_MAX_DEPTH = 4;
const REDACTED_VALUE = "[redacted]";

const SENSITIVE_KEY_PATTERN =
  /(authorization|api[_-]?key|token|secret|password|cookie|credential|client_secret|access_token|refresh_token|session|jwt)/i;

type TelemetrySanitizeOptions = {
  maxStringLength?: number;
  maxItems?: number;
  maxDepth?: number;
};

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

function redactStringSecrets(
  value: string,
  options: Required<TelemetrySanitizeOptions>
) {
  const jsonRedacted = maybeRedactJsonString(value, options);
  const redacted = (jsonRedacted ?? value)
    .replace(/\bbearer\s+[\w+./=~-]+\b/gi, "Bearer [redacted]")
    .replace(/(x-access-token:)[^\s@]+@/gi, "$1[redacted]@")
    .replace(/\b(?:gh[oprsu]_\w+|github_pat_\w+)\b/g, REDACTED_VALUE)
    .replace(/\bsk-[\w-]{8,}\b/g, REDACTED_VALUE)
    .replace(/\bsb_secret_[\w-]+\b/g, REDACTED_VALUE);

  return truncateTelemetryString(redacted, options.maxStringLength);
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
        SENSITIVE_KEY_PATTERN.test(key)
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

import { mogplexApiError } from "@/lib/mogplex-api/response";

export const MOGPLEX_API_IDEMPOTENCY_KEY_HEADER = "idempotency-key";
export const MOGPLEX_API_MAX_IDEMPOTENCY_KEY_LENGTH = 200;
export const MOGPLEX_API_DEFAULT_LIST_LIMIT = 100;
export const MOGPLEX_API_MAX_LIST_LIMIT = 200;

export type MogplexApiIdempotencyKeyResult =
  | { ok: true; value: string }
  | { ok: false; error: "missing" | "too_long" };

export function parseMogplexApiListLimit(
  value: string | null,
  options: {
    defaultLimit?: number;
    maxLimit?: number;
  } = {}
) {
  const defaultLimit = options.defaultLimit ?? MOGPLEX_API_DEFAULT_LIST_LIMIT;
  const maxLimit = options.maxLimit ?? MOGPLEX_API_MAX_LIST_LIMIT;
  if (!value) return defaultLimit;

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return defaultLimit;
  return Math.min(maxLimit, Math.max(1, parsed));
}

export function normalizeOptionalSearchParam(value: string | null) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function readMogplexApiIdempotencyKey(headers: Pick<Headers, "get">) {
  const result = readMogplexApiIdempotencyKeyResult(headers);
  return result.ok ? result.value : null;
}

export function readMogplexApiIdempotencyKeyResult(
  headers: Pick<Headers, "get">
): MogplexApiIdempotencyKeyResult {
  const value = normalizeOptionalSearchParam(
    headers.get(MOGPLEX_API_IDEMPOTENCY_KEY_HEADER)
  );
  if (!value) return { ok: false, error: "missing" };
  if (value.length > MOGPLEX_API_MAX_IDEMPOTENCY_KEY_LENGTH) {
    return { ok: false, error: "too_long" };
  }
  return { ok: true, value };
}

/**
 * Reads the required Idempotency-Key header for a route that starts work, or
 * the 400 response to return when it is missing or too long.
 */
export function requireMogplexApiIdempotencyKey(
  headers: Pick<Headers, "get">
): { ok: true; value: string } | { ok: false; response: Response } {
  const result = readMogplexApiIdempotencyKeyResult(headers);
  if (result.ok) return result;
  const message =
    result.error === "too_long"
      ? `Idempotency-Key exceeds maximum length of ${MOGPLEX_API_MAX_IDEMPOTENCY_KEY_LENGTH} characters`
      : "Idempotency-Key is required";
  return {
    ok: false,
    response: mogplexApiError("BAD_REQUEST", message, 400),
  };
}

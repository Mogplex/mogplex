/**
 * Error detection utilities for sandbox readiness reconciliation.
 * Handles detection of snapshot_not_found errors across various SDK and REST
 * envelope formats returned by the Vercel sandbox API.
 */

function getObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

// Bail at 5 levels — guards against accidental cycles (e.g. error.cause === error)
// in SDK or JSON-parsed error chains that would otherwise blow the stack.
const MAX_ERROR_INSPECTION_DEPTH = 5;

function getErrorCode(value: unknown, depth = 0): string | null {
  if (depth > MAX_ERROR_INSPECTION_DEPTH) return null;
  const object = getObject(value);
  if (!object) return null;
  if (typeof object.code === "string") return object.code;

  return getErrorCode(object.error, depth + 1);
}

function getHttpStatus(error: unknown, depth = 0): number | null {
  if (depth > MAX_ERROR_INSPECTION_DEPTH) return null;
  const object = getObject(error);
  if (!object) return null;
  if (typeof object.status === "number") return object.status;
  if (typeof object.statusCode === "number") return object.statusCode;
  return getHttpStatus(object.response, depth + 1);
}

function bodyIncludesSnapshotNotFound(value: unknown, depth = 0): boolean {
  if (depth > MAX_ERROR_INSPECTION_DEPTH) return false;
  if (typeof value === "string") {
    return value.includes("snapshot_not_found");
  }

  const object = getObject(value);
  if (!object) return false;
  return (
    getErrorCode(object, depth + 1) === "snapshot_not_found" ||
    bodyIncludesSnapshotNotFound(object.body, depth + 1) ||
    bodyIncludesSnapshotNotFound(object.data, depth + 1)
  );
}

// Three-level detection so we catch snapshot_not_found across the shapes the
// Vercel sandbox SDK and REST envelopes return it in:
//   1. SDK errors expose the code at `.json.error.code`.
//   2. Plain errors expose `.code` directly at the top level.
//   3. REST envelopes return HTTP 400 with the marker buried in `.body`/`.data`
//      (string or nested object), so scan only those fields — scanning the
//      whole error object would risk a false positive from an unrelated
//      message/URL that happened to contain "snapshot_not_found".
export function isSnapshotNotFoundSandboxError(error: unknown): boolean {
  const object = getObject(error);
  if (!object) return false;
  if (getErrorCode(object.json) === "snapshot_not_found") return true;
  if (object.code === "snapshot_not_found") return true;

  return (
    getHttpStatus(object) === 400 &&
    (bodyIncludesSnapshotNotFound(object.body) ||
      bodyIncludesSnapshotNotFound(object.data))
  );
}

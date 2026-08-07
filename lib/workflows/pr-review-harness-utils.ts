import type { ReviewFinding } from "@/lib/types";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function toOptionalString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function toStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (entry): entry is string =>
        typeof entry === "string" && entry.trim().length > 0
    )
    .slice(0, 20);
}

export function toPositiveInteger(value: unknown) {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0 &&
    Number.isSafeInteger(value)
    ? value
    : null;
}

export function toReviewFindingSeverity(
  value: unknown
): ReviewFinding["severity"] | null {
  return value === "critical" || value === "warning" || value === "suggestion"
    ? value
    : null;
}

export function toReviewFindings(value: unknown): ReviewFinding[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];

    const severity = toReviewFindingSeverity(entry.severity);
    const title = toOptionalString(entry.title);
    const body = toOptionalString(entry.body);

    if (!severity || !title || !body) {
      return [];
    }

    return [
      {
        severity,
        title,
        body,
        path: toOptionalString(entry.path),
        line: toPositiveInteger(entry.line),
      },
    ];
  });
}

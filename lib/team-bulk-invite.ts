export type BulkInviteRole = "admin" | "developer" | "viewer";

export type BulkInviteStatus =
  | "invited"
  | "skipped_member"
  | "skipped_invalid"
  | "skipped_duplicate"
  | "delivery_failed"
  | "insert_failed";

export type BulkInviteResult = {
  email: string;
  status: BulkInviteStatus;
  invite_id?: string;
};

export type BulkInviteSummary = {
  total_requested: number;
  invited: number;
  skipped_member: number;
  skipped_invalid: number;
  skipped_duplicate: number;
  delivery_failed: number;
  insert_failed: number;
};

export type BulkInviteResponse = {
  results: BulkInviteResult[];
  summary: BulkInviteSummary;
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const MAX_BULK_INVITE_EMAILS = 100;
export const BULK_INVITE_SEND_CONCURRENCY = 10;

export function isValidInviteEmail(value: string): boolean {
  return EMAIL_REGEX.test(value);
}

// Normalises (trim + lowercase) and partitions an input list of email strings
// into the unique-and-valid set plus a pre-built results array for everything
// that was rejected up front (invalid shape or duplicate).
export function prepareBulkInviteEmails(rawEmails: unknown[]): {
  validEmails: string[];
  preResults: BulkInviteResult[];
} {
  const preResults: BulkInviteResult[] = [];
  const seen = new Set<string>();
  const validEmails: string[] = [];

  for (const raw of rawEmails) {
    if (typeof raw !== "string") {
      preResults.push({
        email: String(raw ?? ""),
        status: "skipped_invalid",
      });
      continue;
    }
    const trimmed = raw.trim().toLowerCase();
    if (!trimmed || !isValidInviteEmail(trimmed)) {
      preResults.push({ email: trimmed || raw, status: "skipped_invalid" });
      continue;
    }
    if (seen.has(trimmed)) {
      preResults.push({ email: trimmed, status: "skipped_duplicate" });
      continue;
    }
    seen.add(trimmed);
    validEmails.push(trimmed);
  }

  return { validEmails, preResults };
}

export function summarizeBulkInviteResults(
  results: BulkInviteResult[],
  totalRequested: number
): BulkInviteSummary {
  return {
    total_requested: totalRequested,
    invited: results.filter((r) => r.status === "invited").length,
    skipped_member: results.filter((r) => r.status === "skipped_member").length,
    skipped_invalid: results.filter((r) => r.status === "skipped_invalid")
      .length,
    skipped_duplicate: results.filter((r) => r.status === "skipped_duplicate")
      .length,
    delivery_failed: results.filter((r) => r.status === "delivery_failed")
      .length,
    insert_failed: results.filter((r) => r.status === "insert_failed").length,
  };
}

export function chunkEmails<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}

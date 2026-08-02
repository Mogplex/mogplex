import { supabaseAdmin } from "@/lib/supabase/admin";

export const WAITLIST_REQUEST_EMAIL_MAX = 320;
export const WAITLIST_REQUEST_FIELD_MAX = 500;

// RFC-5321 is more permissive, but this matches what HTML email inputs accept
// and what real signups look like. Reject obvious junk early.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type WaitlistRequestInput = {
  email: string;
  name?: string | null;
  company?: string | null;
  useCase?: string | null;
  source?: string;
};

export type NormalizedWaitlistRequest = {
  email: string;
  name: string | null;
  company: string | null;
  useCase: string | null;
  source: string;
};

export type WaitlistRequestResult =
  | { ok: true; alreadyRequested: boolean }
  | { ok: false; reason: "invalid_email" | "invalid_field" | "storage_error" };

// Returns null for: non-strings, whitespace-only, and over-length strings.
// Callers that need to distinguish "field omitted" from "field too long" must
// check the raw input is a non-empty string before treating null as an error.
function trimOrNull(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) return null;
  return trimmed;
}

function isOverLength(raw: unknown, normalized: string | null): boolean {
  return (
    typeof raw === "string" && raw.trim().length > 0 && normalized === null
  );
}

export function normalizeWaitlistRequest(
  input: unknown
): NormalizedWaitlistRequest | { error: "invalid_email" | "invalid_field" } {
  if (!input || typeof input !== "object") return { error: "invalid_email" };
  const raw = input as Record<string, unknown>;

  const email = trimOrNull(raw.email, WAITLIST_REQUEST_EMAIL_MAX);
  if (!email || !EMAIL_RE.test(email)) return { error: "invalid_email" };

  const lowered = email.toLowerCase();

  const name = trimOrNull(raw.name, WAITLIST_REQUEST_FIELD_MAX);
  if (isOverLength(raw.name, name)) return { error: "invalid_field" };

  const company = trimOrNull(raw.company, WAITLIST_REQUEST_FIELD_MAX);
  if (isOverLength(raw.company, company)) return { error: "invalid_field" };

  const useCase = trimOrNull(raw.useCase, WAITLIST_REQUEST_FIELD_MAX * 4);
  if (isOverLength(raw.useCase, useCase)) return { error: "invalid_field" };

  const source =
    trimOrNull(raw.source, WAITLIST_REQUEST_FIELD_MAX) ?? "marketing_site";

  return { email: lowered, name, company, useCase, source };
}

export async function recordWaitlistRequest(
  input: NormalizedWaitlistRequest
): Promise<WaitlistRequestResult> {
  // Server-side RPC returns Postgres' `xmax = 0` newly-inserted signal so
  // duplicate detection is deterministic — no timestamp window, no false
  // negatives on rapid double-submits or under clock skew.
  const { data, error } = await supabaseAdmin.rpc("record_waitlist_request", {
    p_email: input.email,
    p_name: input.name,
    p_company: input.company,
    p_use_case: input.useCase,
    p_source: input.source,
  });

  if (error || !Array.isArray(data) || data.length === 0) {
    return { ok: false, reason: "storage_error" };
  }

  // The cast here is a type assertion, not a runtime check. A null or
  // missing `inserted` would silently become `false` under `Boolean(…)`
  // and flip a fresh submission's `alreadyRequested` to `true` — telling
  // a real first-time user they've already requested access. Treat any
  // non-boolean as a storage error.
  const row = data[0] as { inserted: unknown };
  if (typeof row.inserted !== "boolean") {
    return { ok: false, reason: "storage_error" };
  }
  return { ok: true, alreadyRequested: !row.inserted };
}

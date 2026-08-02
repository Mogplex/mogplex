import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { isReservedSlug } from "@/lib/reserved-slugs";

const SLUG_MAX_LEN = 39;
const SCOPE_SLUG_RE = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/;
// Small suffix budget — the UUID fallback is effectively collision-free,
// so we don't need to burn dozens of round-trips trying base-2…base-100.
const MAX_SUFFIX_ATTEMPTS = 5;
// Postgres unique_violation. The profiles slug index raises this with
// constraint = "profiles_slug_key". The cross-namespace check in
// public.assert_slug_available() raises 23505 from plpgsql with no
// constraint name. Both are slug collisions and safe to retry.
// Other 23505s (e.g. id PK collision) must NOT be retried.
const UNIQUE_VIOLATION = "23505";
const SLUG_CONSTRAINT = "profiles_slug_key";

export function buildSlugCandidate(
  source: string | null | undefined
): string | null {
  let base = (source ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "-");
  base = base
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX_LEN);
  if (!base || !SCOPE_SLUG_RE.test(base) || isReservedSlug(base)) {
    return null;
  }
  return base;
}

function applySuffix(base: string, suffix: string): string {
  // Truncating the base to fit the suffix must leave at least one
  // [a-z0-9] character — otherwise the result starts with "-" and
  // fails SCOPE_SLUG_RE. Callers guarantee base.length >= 1; if it
  // ever didn't, the DB would reject and we'd bail on a non-unique
  // error, but assert defensively.
  const room = SLUG_MAX_LEN - suffix.length;
  if (room < 1) {
    throw new Error(`applySuffix: suffix "${suffix}" too long for slug`);
  }
  return `${base.slice(0, room)}${suffix}`;
}

function randomFallbackSlug(): string {
  return `user-${crypto.randomUUID().slice(0, 8)}`;
}

function isSlugCollision(error: PostgrestError): boolean {
  if (error.code !== UNIQUE_VIOLATION) return false;
  // Unique-index violations carry the constraint name; trigger-raised
  // 23505 from assert_slug_available has no constraint. Both are slug
  // collisions. Any OTHER named constraint (e.g. profiles_pkey on id)
  // is a non-retryable bug — bail.
  const constraint = (error as PostgrestError & { constraint?: string })
    .constraint;
  return !constraint || constraint === SLUG_CONSTRAINT;
}

export type ProfileInsertPayload = Record<string, unknown>;

export type InsertProfileResult =
  | { ok: true; slug: string }
  | { ok: false; error: PostgrestError };

// Inserts a profile row, retrying on slug-collision with -2…-N
// suffixes, then a UUID-suffixed fallback. Non-slug errors (RLS,
// pk-collisions, network) abort immediately.
export async function insertProfileWithUniqueSlug(
  admin: SupabaseClient,
  payload: ProfileInsertPayload,
  slugSource: { githubUsername?: string | null; email?: string | null }
): Promise<InsertProfileResult> {
  const emailLocal = slugSource.email ? slugSource.email.split("@")[0] : null;
  const base =
    buildSlugCandidate(slugSource.githubUsername || emailLocal) ??
    randomFallbackSlug();

  const candidates: string[] = [base];
  for (let n = 2; n <= MAX_SUFFIX_ATTEMPTS; n += 1) {
    candidates.push(applySuffix(base, `-${n}`));
  }
  candidates.push(applySuffix(base, `-${crypto.randomUUID().slice(0, 8)}`));

  let lastError: PostgrestError | null = null;
  for (const slug of candidates) {
    const { error } = await admin.from("profiles").insert({ ...payload, slug });

    if (!error) return { ok: true, slug };

    lastError = error;
    if (!isSlugCollision(error)) {
      return { ok: false, error };
    }
  }

  return {
    ok: false,
    error:
      lastError ??
      ({
        message: "exhausted slug candidates",
        code: UNIQUE_VIOLATION,
        details: "",
        hint: "",
        name: "PostgrestError",
      } as PostgrestError),
  };
}

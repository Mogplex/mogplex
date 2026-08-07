/**
 * Detect Postgres unique-constraint violations (code 23505) in an error chain.
 */
export function isPostgresUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const maybeCode = (error as { code?: unknown }).code;
  if (maybeCode === "23505") return true;
  return isPostgresUniqueViolation((error as { cause?: unknown }).cause);
}

/**
 * Escape wildcards for Supabase PostgREST ilike queries.
 */
export function escapePostgrestLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

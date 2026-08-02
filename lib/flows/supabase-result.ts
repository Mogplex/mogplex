/**
 * Supabase returns `{ data, error }` rather than throwing, so every query site
 * grows the same `if (result.error) throw` branch. These collapse it.
 *
 * They live apart from `lib/flows/api.ts` so they can be exercised without
 * pulling in that module's Supabase and AI SDK imports.
 */

type SupabaseResult<T> = {
  data: T;
  error: { message: string } | null;
};

/**
 * Turn a Supabase error into a throw and hand back the payload.
 *
 * Note this deliberately does not narrow `null` out of `T` — a successful
 * single-row query still legitimately returns `null` when nothing matched, so
 * callers keep using `?.` on the result.
 */
export function unwrapOrThrow<T>(result: SupabaseResult<T>): T {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

/** Row-list variant of `unwrapOrThrow` that normalizes a null payload to `[]`. */
export function unwrapRowsOrThrow<T>(result: SupabaseResult<T[] | null>): T[] {
  if (result.error) throw new Error(result.error.message);
  return result.data ?? [];
}

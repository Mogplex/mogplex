export const FETCH_ALL_PAGE_SIZE = 5000;

type PageableQuery = {
  order: (
    column: string,
    opts: { ascending: boolean }
  ) => PageableQuery & {
    range: (
      from: number,
      to: number
    ) => PromiseLike<{
      data: unknown[] | null;
      error: { message: string } | null;
    }>;
  };
};

/**
 * Fetch every row matching a query, paging until exhaustion. Use this instead
 * of a hardcoded `.limit(N)` whenever downstream logic needs the complete
 * result set to be correct (protection sets, per-entity aggregation,
 * pagination totals) — a cap there silently produces wrong answers once the
 * table outgrows it.
 *
 * `orderColumn` should be an insertion-time column (with `id` appended as a
 * tiebreak) so rows inserted mid-scan land after the cursor instead of
 * shifting unseen rows into already-read pages.
 */
export async function fetchAllRows(
  buildQuery: () => PageableQuery,
  orderColumn: string,
  label: string
): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (let offset = 0; ; offset += FETCH_ALL_PAGE_SIZE) {
    const { data, error } = await buildQuery()
      .order(orderColumn, { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + FETCH_ALL_PAGE_SIZE - 1);
    if (error) {
      throw new Error(`Failed to load ${label}: ${error.message}`);
    }
    const page = data ?? [];
    rows.push(...page);
    if (page.length < FETCH_ALL_PAGE_SIZE) return rows;
  }
}

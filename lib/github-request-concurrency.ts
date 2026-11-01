/** Keep installation discovery and inventory complete without unbounded API fan-out. */
export async function mapGithubRequests<T, R>(
  items: readonly T[],
  operation: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(3, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await operation(items[index]);
      }
    })
  );
  return results;
}

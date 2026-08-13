export function mergeControlSessionLists<T extends { id: string }>(
  current: T[],
  fetched: T[],
  removedIds: ReadonlySet<string>
): T[] {
  const currentIds = new Set(current.map((session) => session.id));
  return [
    ...current,
    ...fetched.filter(
      (session) => !currentIds.has(session.id) && !removedIds.has(session.id)
    ),
  ];
}

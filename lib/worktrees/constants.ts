export const WORKTREE_RESERVATION_STALE_MS = 5 * 60 * 1000;

export function isStaleWorktreeReservation(
  updatedAt: string,
  now = Date.now()
): boolean {
  const updatedAtMs = Date.parse(updatedAt);
  return (
    Number.isFinite(updatedAtMs) &&
    updatedAtMs < now - WORKTREE_RESERVATION_STALE_MS
  );
}

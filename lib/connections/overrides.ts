import type { ConnectionOverride } from "@/lib/types";

/**
 * Pure helper that returns the overrides array after applying an
 * exclude/include change for a single connection in a given repo.
 *
 * - `excluded=true` upserts an `excluded` override.
 * - `excluded=false` removes any existing override for that connection.
 *
 * Used by `useConnections.setExcluded` for optimistic cache updates.
 * New rows use an `optimistic-<id>` placeholder id that the server
 * replaces on revalidate.
 */
export function patchOverrides(
  overrides: ConnectionOverride[],
  repoId: string,
  connectionId: string,
  excluded: boolean
): ConnectionOverride[] {
  const existing = overrides.find((o) => o.connection_id === connectionId);
  if (excluded) {
    if (existing) {
      return overrides.map((o) =>
        o.connection_id === connectionId ? { ...o, excluded: true } : o
      );
    }
    return [
      ...overrides,
      {
        id: `optimistic-${connectionId}`,
        repo_id: repoId,
        connection_id: connectionId,
        excluded: true,
        created_at: new Date().toISOString(),
      },
    ];
  }
  return overrides.filter((o) => o.connection_id !== connectionId);
}

// Leaf module: imported by both lib/types.ts and lib/connections/status.ts,
// so it must not import from either.
export const CONNECTION_HEALTH_STATUSES = [
  "unknown",
  "testing",
  "healthy",
  "auth_failed",
  "unreachable",
  "misconfigured",
  "error",
] as const;

export type ConnectionHealthStatus =
  (typeof CONNECTION_HEALTH_STATUSES)[number];

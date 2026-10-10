/**
 * What a Mogplex API key may do. The key's owner picks it in Settings →
 * Mogplex Keys; a team owner can hold every key to `automations` on the
 * team's repositories.
 *
 * - `full`: whatever the key's scopes allow.
 * - `automations`: read, and start work only by triggering an automation with
 *   an API trigger.
 *
 * Kept free of imports so client components and the auth layer can share it.
 */
export const API_KEY_ACCESS_LEVELS = ["full", "automations"] as const;
export type ApiKeyAccess = (typeof API_KEY_ACCESS_LEVELS)[number];

export function isApiKeyAccess(value: unknown): value is ApiKeyAccess {
  return value === "full" || value === "automations";
}

/** Which row a stored access value came from, so a warning names it. */
export type StoredApiKeyAccessSource = { keyId: string } | { teamId: string };

const MAX_WARNED_ROWS = 500;
const warnedRows = new Set<string>();

/**
 * A stored value read from the database. Anything unexpected reads as the
 * restrictive level, and is logged so a bad row or migration gets noticed.
 * Each row and value is logged once per server instance, so a key that calls
 * the API in a loop does not flood the logs.
 */
export function readStoredApiKeyAccess(
  value: unknown,
  source?: StoredApiKeyAccessSource
): ApiKeyAccess {
  if (value === null || value === undefined) return "full";
  if (isApiKeyAccess(value)) return value;
  const storedValue = String(value).slice(0, 40);
  const rowKey = `${source ? JSON.stringify(source) : "unknown"}:${storedValue}`;
  if (!warnedRows.has(rowKey)) {
    if (warnedRows.size >= MAX_WARNED_ROWS) warnedRows.clear();
    warnedRows.add(rowKey);
    console.warn(
      "[api-key-access] unknown stored access; treating as automations",
      { ...source, value: storedValue }
    );
  }
  return "automations";
}

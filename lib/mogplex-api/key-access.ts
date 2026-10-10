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

/**
 * A stored value read from the database. Anything unexpected reads as the
 * restrictive level, and is logged so a bad row or migration gets noticed.
 */
export function readStoredApiKeyAccess(value: unknown): ApiKeyAccess {
  if (value === null || value === undefined) return "full";
  if (isApiKeyAccess(value)) return value;
  console.warn(
    "[api-key-access] unknown stored access; treating as automations",
    {
      value: String(value).slice(0, 40),
    }
  );
  return "automations";
}

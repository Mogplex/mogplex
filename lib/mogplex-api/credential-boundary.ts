import type { NextResponse } from "next/server";
import type { ApiKeyAccess } from "./key-access";
import { mogplexApiError, type MogplexApiErrorBody } from "./response";

/**
 * Who is behind a v1 API credential.
 *
 * - `integration`: a Mogplex API key (`mog_…`), usually held by a server.
 * - `interactive`: an OAuth token a person approved in the browser, used by
 *   the Mogplex CLI or an MCP client acting for that person.
 */
export type MogplexApiCredentialKind = "integration" | "interactive";

export {
  API_KEY_ACCESS_LEVELS,
  isApiKeyAccess,
  readStoredApiKeyAccess,
  type ApiKeyAccess,
} from "./key-access";

export type MogplexApiCredential = {
  credentialKind: MogplexApiCredentialKind;
  /** The key's own access level; null for interactive credentials. */
  keyAccess: ApiKeyAccess | null;
};

export const AUTOMATION_REQUIRED_MESSAGE =
  "This Mogplex API key is set to Automations only, so it can start work only through a configured automation. " +
  "Call POST /api/v1/mogplex/automations/{automationId}/trigger for an enabled automation with an API trigger, " +
  "or change the key to Full access in Settings → Mogplex Keys.";

export const TEAM_AUTOMATION_REQUIRED_MESSAGE =
  "This team allows Mogplex API keys to start work on its repositories only through a configured automation. " +
  "Call POST /api/v1/mogplex/automations/{automationId}/trigger for an enabled automation with an API trigger. " +
  "A team owner can change this in the team's settings.";

/**
 * True when the credential may start work only through an API-trigger
 * automation: an `automations` key anywhere, or any key on a repository whose
 * team holds keys to automations. Interactive logins are never restricted.
 */
export function isAutomationOnly(
  user: MogplexApiCredential,
  teamAccess: ApiKeyAccess | null = null
): boolean {
  if (user.credentialKind !== "integration") return false;
  return user.keyAccess !== "full" || teamAccess === "automations";
}

/**
 * Returns null when the key itself has full access (or the credential is an
 * interactive login), otherwise the 403 the route returns before it reads the
 * body or creates anything. Team policy is checked once the route knows the
 * repository; see `requireKeyAllowedOn`.
 */
export function requireFullAccessKey(
  user: MogplexApiCredential
): NextResponse<MogplexApiErrorBody> | null {
  if (!isAutomationOnly(user)) return null;
  return mogplexApiError(
    "AUTOMATION_REQUIRED",
    AUTOMATION_REQUIRED_MESSAGE,
    403
  );
}

/** The 403 for a full-access key on a team that holds keys to automations. */
export function teamAutomationRequired(): NextResponse<MogplexApiErrorBody> {
  return mogplexApiError(
    "AUTOMATION_REQUIRED",
    TEAM_AUTOMATION_REQUIRED_MESSAGE,
    403
  );
}

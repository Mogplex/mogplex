import { getResolvedAuth } from "@/lib/auth";
import {
  AUTOMATION_REQUIRED_MESSAGE,
  TEAM_AUTOMATION_REQUIRED_MESSAGE,
} from "@/lib/mogplex-api/credential-boundary";
import type { ApiKeyAccess } from "@/lib/mogplex-api/key-access";
import { loadTeamApiKeyAccessById } from "@/lib/mogplex-api/team-key-access";

export type DirectExecutionUser =
  | {
      userId: string;
      viaApiKey: false;
    }
  | {
      userId: string;
      /** Only full keys reach this boundary; others throw SandboxKeyRestrictedError. */
      apiKeyAccess: ApiKeyAccess;
      /** True when the request came from a Mogplex API key, so team policy applies. */
      viaApiKey: true;
    };

/**
 * Thrown when a Mogplex API key is held to automations, by its own access or
 * by the team it acts in. Sandbox routes answer it with 403 like a capability
 * denial, so the caller learns why instead of seeing 401.
 */
export class SandboxKeyRestrictedError extends Error {
  readonly status = 403;
  readonly code = "AUTOMATION_REQUIRED";
  constructor(heldBy: "key" | "team") {
    super(
      heldBy === "team"
        ? TEAM_AUTOMATION_REQUIRED_MESSAGE
        : AUTOMATION_REQUIRED_MESSAGE
    );
    this.name = "SandboxKeyRestrictedError";
  }
}

/**
 * The account that may launch sandboxes and run raw prompts for this request:
 * a signed-in person, an OAuth login, or a full-access Mogplex API key.
 * Undefined when there are no credentials. A key set to Automations only
 * reaches this work only through an automation, so it throws
 * {@link SandboxKeyRestrictedError}. The proxy already rejects those keys on
 * these paths; this keeps the rule when a route is reached another way.
 */
export async function getDirectExecutionUser(
  resolveAuth: typeof getResolvedAuth = getResolvedAuth
): Promise<DirectExecutionUser | undefined> {
  const auth = await resolveAuth();
  if (!auth) return undefined;
  if (auth.source !== "api-key") {
    return { userId: auth.profileId, viaApiKey: false };
  }
  if (auth.apiKeyAccess !== "full") throw new SandboxKeyRestrictedError("key");
  return { userId: auth.profileId, viaApiKey: true, apiKeyAccess: "full" };
}

/**
 * Throws {@link SandboxKeyRestrictedError} when a team owner holds members'
 * keys to automations and this request came from a key acting in that team:
 * the key may not launch or drive a sandbox there directly. Personal work and
 * interactive logins always pass.
 */
export async function assertMayExecuteInTeam(
  actor: DirectExecutionUser,
  teamId: string | null | undefined,
  loadTeamAccess: typeof loadTeamApiKeyAccessById = loadTeamApiKeyAccessById
): Promise<void> {
  if (!actor.viaApiKey || !teamId) return;
  if ((await loadTeamAccess(teamId)) === "automations") {
    throw new SandboxKeyRestrictedError("team");
  }
}

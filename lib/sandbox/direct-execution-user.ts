import { getResolvedAuth } from "@/lib/auth";
import { loadTeamApiKeyAccessById } from "@/lib/mogplex-api/team-key-access";

export type DirectExecutionUser = {
  userId: string;
  /** True when the request came from a Mogplex API key, so team policy applies. */
  viaApiKey: boolean;
};

/**
 * The account that may launch sandboxes and run raw prompts for this request:
 * a signed-in person, an OAuth login, or a full-access Mogplex API key. A key
 * set to Automations only reaches this work only through an automation. The
 * proxy already rejects those keys on these paths; this keeps the rule when a
 * route is reached another way.
 */
export async function getDirectExecutionUser(
  resolveAuth: typeof getResolvedAuth = getResolvedAuth
): Promise<DirectExecutionUser | undefined> {
  const auth = await resolveAuth();
  if (!auth) return undefined;
  if (auth.source !== "api-key") {
    return { userId: auth.profileId, viaApiKey: false };
  }
  if (auth.apiKeyAccess !== "full") return undefined;
  return { userId: auth.profileId, viaApiKey: true };
}

/**
 * False when a team owner holds members' keys to automations and this request
 * came from a key acting in that team: the key may not launch or drive a
 * sandbox there directly. Personal work and interactive logins always pass.
 */
export async function mayExecuteInTeam(
  actor: DirectExecutionUser,
  teamId: string | null | undefined,
  loadTeamAccess: typeof loadTeamApiKeyAccessById = loadTeamApiKeyAccessById
): Promise<boolean> {
  if (!actor.viaApiKey || !teamId) return true;
  return (await loadTeamAccess(teamId)) !== "automations";
}

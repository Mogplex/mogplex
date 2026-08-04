import { buildUserProviderAccess } from "@/lib/models/provider-reachability";
import { loadUserPlatformAccess } from "@/lib/platform-access";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { listProviderKeys, listTeamProviderKeys } from "@/lib/vault";
import type { UserProviderAccess } from "@/lib/models/provider-reachability";

// Provider access for a user in a scope: their own vault keys, the active
// team's keys when they are a verified member, and platform access. Throws on
// storage failures so callers decide whether to surface or fall back —
// silently treating a transient outage as "no access" would make every model
// look unreachable.
export async function loadScopedUserProviderAccess(
  userId: string,
  teamId: string | null
): Promise<UserProviderAccess> {
  const teamKeysPromise = teamId
    ? supabaseAdmin
        .from("team_members")
        .select("user_id")
        .eq("team_id", teamId)
        .eq("user_id", userId)
        .maybeSingle()
        .then(({ data, error }) => {
          if (error) {
            throw new Error(
              `Failed to verify team membership: ${error.message}`
            );
          }
          return data ? listTeamProviderKeys(teamId) : [];
        })
    : Promise.resolve([]);
  const [keys, teamKeys, platform] = await Promise.all([
    listProviderKeys(userId),
    teamKeysPromise,
    loadUserPlatformAccess(userId, teamId),
  ]);
  const providers = new Set([
    ...keys.map((row) => row.provider),
    ...teamKeys.map((row) => row.provider),
  ]);
  return buildUserProviderAccess(providers, {
    allowPlatformAi: platform.allowPlatformAi,
  });
}

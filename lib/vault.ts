import { supabaseAdmin } from "@/lib/supabase/admin";

export type Provider = "ai_gateway" | "anthropic" | "openai" | "openrouter";

export async function storeProviderKey(
  userId: string,
  provider: Provider,
  apiKey: string
) {
  const { error } = await supabaseAdmin.rpc("store_provider_key", {
    p_user_id: userId,
    p_provider: provider,
    p_key: apiKey,
  });
  if (error) throw new Error(`Failed to store key: ${error.message}`);
}

export async function getProviderKey(
  userId: string,
  provider: Provider
): Promise<string | null> {
  const { data, error } = await supabaseAdmin.rpc("get_provider_key", {
    p_user_id: userId,
    p_provider: provider,
  });
  if (error) throw new Error(`Failed to get key: ${error.message}`);
  return data as string | null;
}

export type GetScopedProviderKeyDeps = {
  isTeamMember: (userId: string, teamId: string) => Promise<boolean>;
  getTeamProviderKey: (
    teamId: string,
    provider: Provider
  ) => Promise<string | null>;
  getPersonalProviderKey: (
    userId: string,
    provider: Provider
  ) => Promise<string | null>;
};

const defaultIsTeamMember: GetScopedProviderKeyDeps["isTeamMember"] = async (
  userId,
  teamId
) => {
  const { data, error } = await supabaseAdmin
    .from("team_members")
    .select("user_id")
    .eq("team_id", teamId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error)
    throw new Error(`Failed to verify team membership: ${error.message}`);
  return Boolean(data);
};

const defaultGetTeamProviderKey: GetScopedProviderKeyDeps["getTeamProviderKey"] =
  async (teamId, provider) => {
    const { data, error } = await supabaseAdmin.rpc("get_team_provider_key", {
      p_team_id: teamId,
      p_provider: provider,
    });
    if (error) throw new Error(`Failed to get team key: ${error.message}`);
    return data as string | null;
  };

const defaultGetScopedProviderKeyDeps: GetScopedProviderKeyDeps = {
  isTeamMember: defaultIsTeamMember,
  getTeamProviderKey: defaultGetTeamProviderKey,
  getPersonalProviderKey: getProviderKey,
};

/**
 * Scope-aware provider key lookup. When `teamId` is set, prefer the team's
 * shared key (admin-managed via `team_provider_keys`); fall back to the
 * user's personal key. Solo scope (no teamId) is just `getProviderKey`.
 *
 * **Membership-gated**: `get_team_provider_key` is SECURITY DEFINER and has
 * no auth check inside the RPC (see
 * supabase/migrations/20260517190000_teams_rbac_phase_0.sql comment on
 * line 391). The app layer is responsible for confirming the caller belongs
 * to the team before consuming the shared key — otherwise a user in
 * teams A and B could cherry-pick whichever team's vault holds the more
 * privileged key by manipulating the `x-mogplex-team-id` header. Non-members
 * of `teamId` silently fall through to their personal key, matching the
 * "header is a hint" model.
 */
export function createGetScopedProviderKey(
  overrides: Partial<GetScopedProviderKeyDeps> = {}
) {
  const deps: GetScopedProviderKeyDeps = {
    ...defaultGetScopedProviderKeyDeps,
    ...overrides,
  };
  return async function getScopedProviderKey(
    userId: string,
    provider: Provider,
    teamId?: string | null
  ): Promise<string | null> {
    if (teamId && (await deps.isTeamMember(userId, teamId))) {
      const teamKey = await deps.getTeamProviderKey(teamId, provider);
      if (teamKey) return teamKey;
    }
    return deps.getPersonalProviderKey(userId, provider);
  };
}

export const getScopedProviderKey = createGetScopedProviderKey();

export async function deleteProviderKey(userId: string, provider: Provider) {
  const { error } = await supabaseAdmin.rpc("delete_provider_key", {
    p_user_id: userId,
    p_provider: provider,
  });
  if (error) throw new Error(`Failed to delete key: ${error.message}`);
}

export async function listProviderKeys(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("provider_keys")
    .select("provider, created_at, updated_at")
    .eq("user_id", userId)
    .order("provider");

  if (error) throw new Error(`Failed to list keys: ${error.message}`);
  return data as {
    provider: Provider;
    created_at: string;
    updated_at: string;
  }[];
}

export async function storeTeamProviderKey(
  teamId: string,
  provider: Provider,
  apiKey: string
) {
  const { error } = await supabaseAdmin.rpc("store_team_provider_key", {
    p_team_id: teamId,
    p_provider: provider,
    p_key: apiKey,
  });
  if (error) throw new Error(`Failed to store team key: ${error.message}`);
}

export async function deleteTeamProviderKey(
  teamId: string,
  provider: Provider
) {
  const { error } = await supabaseAdmin.rpc("delete_team_provider_key", {
    p_team_id: teamId,
    p_provider: provider,
  });
  if (error) throw new Error(`Failed to delete team key: ${error.message}`);
}

export async function listTeamProviderKeys(teamId: string) {
  const { data, error } = await supabaseAdmin
    .from("team_provider_keys")
    .select("provider, created_at, updated_at")
    .eq("team_id", teamId)
    .order("provider");

  if (error) throw new Error(`Failed to list team keys: ${error.message}`);
  return data as {
    provider: Provider;
    created_at: string;
    updated_at: string;
  }[];
}

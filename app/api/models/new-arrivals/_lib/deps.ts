import { getUserId, requireUserId } from "@/lib/auth";
import type { ModelUsabilityScope } from "@/lib/models/new-arrival-scoping";
import { buildUserProviderAccess } from "@/lib/models/provider-reachability";
import { loadUserPlatformAccess } from "@/lib/platform-access";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  loadTeamAllowlistState,
  logAllowlistDegradationOnce,
} from "@/lib/team-capabilities";
import { listProviderKeys, listTeamProviderKeys } from "@/lib/vault";

export type ProfileModelSettings = {
  auto_enable_new_models: boolean;
  models_seen_at: string | null;
};

export type CandidateRow = {
  id: string;
  name: string;
  provider: string;
  created_at: string | null;
  is_hidden?: boolean | null;
};

export type NewArrivalsDeps = {
  getUserId: typeof getUserId;
  requireUserId: typeof requireUserId;
  loadProfileModelSettings: (userId: string) => Promise<{
    data: ProfileModelSettings | null;
    error: { message: string } | null;
  }>;
  listCandidateModels: () => Promise<{
    data: CandidateRow[] | null;
    error: { message: string } | null;
  }>;
  listUserPreferenceModelIds: (userId: string) => Promise<{
    data: string[] | null;
    error: { message: string } | null;
  }>;
  disableModelsForUser: (
    userId: string,
    modelIds: string[]
  ) => Promise<{ error: { message: string } | null }>;
  advanceModelsSeenAt: (
    userId: string,
    seenAt: string
  ) => Promise<{ error: { message: string } | null }>;
  setAutoEnableNewModels: (
    userId: string,
    value: boolean
  ) => Promise<{ error: { message: string } | null }>;
  // Assemble the scopes a user could use a model in (their personal scope plus
  // every team they belong to). Used to keep the arrivals popup from surfacing
  // models the user cannot reach or is not allowed to use anywhere.
  loadUserUsabilityScopes: (userId: string) => Promise<{
    data: ModelUsabilityScope[] | null;
    error: { message: string } | null;
    // True when at least one team scope was dropped because its allowlist could
    // not be read, so the caller can tell a genuinely empty result from a
    // narrowed one. Required, not optional: an injected test double that omits
    // it would read as `undefined` and silently opt out of the signal, which
    // gates a persistent write below.
    degraded: boolean;
  }>;
};

async function listUserTeamIds(userId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from("team_members")
    .select("team_id")
    .eq("user_id", userId);
  if (error) {
    throw new Error(`Failed to load team memberships: ${error.message}`);
  }
  return (data ?? []).map((row) => row.team_id as string);
}

export const defaultNewArrivalsDeps: NewArrivalsDeps = {
  getUserId,
  requireUserId,
  async loadProfileModelSettings(userId) {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("auto_enable_new_models, models_seen_at")
      .eq("id", userId)
      .single();

    return {
      data: data as ProfileModelSettings | null,
      error: error ? { message: error.message } : null,
    };
  },
  async listCandidateModels() {
    const { data, error } = await supabaseAdmin
      .from("ai_models")
      .select("id, name, provider, created_at, is_hidden")
      .eq("is_available", true);

    return {
      data: data as CandidateRow[] | null,
      error: error ? { message: error.message } : null,
    };
  },
  async listUserPreferenceModelIds(userId) {
    const { data, error } = await supabaseAdmin
      .from("user_model_preferences")
      .select("model_id")
      .eq("user_id", userId);

    return {
      data: data?.map((row) => row.model_id as string) ?? null,
      error: error ? { message: error.message } : null,
    };
  },
  async disableModelsForUser(userId, modelIds) {
    if (modelIds.length === 0) return { error: null };
    const { error } = await supabaseAdmin.from("user_model_preferences").upsert(
      modelIds.map((modelId) => ({
        user_id: userId,
        model_id: modelId,
        is_enabled: false,
      })),
      { onConflict: "user_id,model_id" }
    );
    return { error: error ? { message: error.message } : null };
  },
  async advanceModelsSeenAt(userId, seenAt) {
    // Monotonic: only move the cursor forward. The `lt` guard makes the write
    // a no-op when a concurrent acknowledgement has already advanced past
    // `seenAt`, so a slow older request cannot clobber a newer value and make
    // already-acknowledged arrivals reappear. `models_seen_at` is NOT NULL, so
    // the guard always has a value to compare against.
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ models_seen_at: seenAt })
      .eq("id", userId)
      .lt("models_seen_at", seenAt);
    return { error: error ? { message: error.message } : null };
  },
  async setAutoEnableNewModels(userId, value) {
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ auto_enable_new_models: value })
      .eq("id", userId);
    return { error: error ? { message: error.message } : null };
  },
  async loadUserUsabilityScopes(userId) {
    // Surface failures rather than swallowing — silently treating the user as
    // "no usable scope" would hide a legitimately-usable new model behind a
    // transient Supabase/Vault outage.
    try {
      const [keys, platform, teamIds] = await Promise.all([
        listProviderKeys(userId),
        loadUserPlatformAccess(userId),
        listUserTeamIds(userId),
      ]);
      const personalProviders = new Set(keys.map((row) => row.provider));
      const platformOpts = { allowPlatformAi: platform.allowPlatformAi };

      // Personal scope: own keys + platform, no allowlist restriction.
      const scopes: ModelUsabilityScope[] = [
        {
          access: buildUserProviderAccess(personalProviders, platformOpts),
          allowlist: null,
        },
      ];

      // Team scopes: own keys + the team's keys, gated by the team allowlist.
      const teamScopes = await Promise.all(
        teamIds.map(async (teamId) => {
          const [teamKeys, allowlistState] = await Promise.all([
            listTeamProviderKeys(teamId),
            loadTeamAllowlistState(teamId),
          ]);
          // Drop just this team's scope rather than degrading it to a null
          // allowlist, which this shape reads as "no restriction" — that would
          // report a model as usable in a team whose allowlist we could not
          // read. Dropping is equally fail-closed for that team (a model is
          // only reported usable if some scope permits it) while leaving the
          // personal scope and every other team's scope intact, so one team's
          // transient read failure does not blank the whole popup.
          if (allowlistState.status === "unknown") {
            // The read itself logs the Supabase message, but not which surface
            // degraded — without a line here a silently narrower popup has no
            // trace at all. Routed through the shared suppression because this
            // endpoint is polled: an un-deduped line would flood at request
            // rate during exactly the outage it is reporting.
            logAllowlistDegradationOnce(
              "new-arrivals",
              teamId,
              allowlistState.reason,
              (message, fields) => console.warn(message, fields)
            );
            return null;
          }
          const providers = new Set([
            ...personalProviders,
            ...teamKeys.map((row) => row.provider),
          ]);
          return {
            access: buildUserProviderAccess(providers, platformOpts),
            allowlist:
              allowlistState.status === "unrestricted"
                ? null
                : new Set(allowlistState.models),
          } satisfies ModelUsabilityScope;
        })
      );
      const usableTeamScopes = teamScopes.filter((scope) => scope !== null);
      scopes.push(...usableTeamScopes);

      return {
        data: scopes,
        error: null,
        degraded: usableTeamScopes.length !== teamScopes.length,
      };
    } catch (error) {
      return {
        data: null,
        degraded: false,
        error: {
          message:
            error instanceof Error
              ? error.message
              : "Failed to load usability scopes",
        },
      };
    }
  },
};

import {
  compareModelsForDefaultSelection,
  DEFAULT_NEW_AGENT_MODEL_ID,
} from "@/lib/agents/model-options";
import { filterVisibleModelCatalog } from "@/lib/models/catalog-visibility";
import { loadScopedUserProviderAccess } from "@/lib/models/provider-access";
import { isModelReachable } from "@/lib/models/provider-reachability";
import {
  buildNewModelDefaultPolicy,
  buildUserModelPreferenceMap,
  resolveUserModelEnabledState,
} from "@/lib/models/user-preferences";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  teamAllowlistMatcher,
  hasCapability,
  modelAllowlistUnavailableError,
  loadTeamAllowlistState,
  modelCapability,
  resolveMemberCapabilities,
} from "@/lib/team-capabilities";
import type {
  NewModelDefaultPolicy,
  UserModelPreferenceRow,
} from "@/lib/models/user-preferences";

type ModelAvailabilityRow = {
  id: string;
  // provider/name feed compareModelsForDefaultSelection so the
  // first-usable-model fallback matches /api/models' ordering; rows without
  // them still sort deterministically (empty-string provider/name, then id).
  provider?: string | null;
  name?: string | null;
  is_available: boolean;
  is_hidden?: boolean | null;
  created_at?: string | null;
};

function listEnabledVisibleModelIds(
  catalog: ModelAvailabilityRow[],
  preferences: UserModelPreferenceRow[],
  policy?: NewModelDefaultPolicy
) {
  const preferenceMap = buildUserModelPreferenceMap(preferences);

  // `is_available` is required even when an explicit preference row says
  // enabled — a model the catalog sync has retired must never be selected
  // (or persisted) as anyone's default.
  // Sorted so `usableModelIds[0]` is deterministic and agrees with
  // /api/models' first-selectable fallback (Postgres returns unordered rows
  // without ORDER BY; forks persist this pick, so it must not vary by call).
  return filterVisibleModelCatalog(catalog)
    .filter(
      (model) =>
        model.is_available &&
        resolveUserModelEnabledState(model, preferenceMap, policy)
    )
    .sort(compareModelsForDefaultSelection)
    .map((model) => model.id);
}

export function isUsableDefaultModelId(
  modelId: string | null | undefined,
  catalog: ModelAvailabilityRow[],
  preferences: UserModelPreferenceRow[],
  policy?: NewModelDefaultPolicy
) {
  if (!modelId) return false;
  return listEnabledVisibleModelIds(catalog, preferences, policy).includes(
    modelId
  );
}

// Picks only from `usableModelIds` — the static default is a preference among
// usable models, never an escape hatch past the filtering. Returns null when
// nothing is usable so callers decide how to fail instead of receiving a model
// the scope cannot invoke.
export function pickUsableDefaultModelId(
  storedDefaultModel: string | null | undefined,
  usableModelIds: string[]
): string | null {
  if (storedDefaultModel && usableModelIds.includes(storedDefaultModel)) {
    return storedDefaultModel;
  }

  if (usableModelIds.includes(DEFAULT_NEW_AGENT_MODEL_ID)) {
    return DEFAULT_NEW_AGENT_MODEL_ID;
  }

  return usableModelIds[0] ?? null;
}

export function resolveUsableDefaultModelId(
  storedDefaultModel: string | null | undefined,
  catalog: ModelAvailabilityRow[],
  preferences: UserModelPreferenceRow[],
  policy?: NewModelDefaultPolicy
) {
  // Runtime/display callers (chat runs, CLI fallback, settings, generator)
  // need a concrete model ID and nothing here is persisted: an unusable
  // fallback fails loudly at invocation via resolveUserLanguageModel. The
  // fail-closed (nullable) contract lives on resolveStoredUserDefaultModelId,
  // whose result is stamped into immutable forks.
  return (
    pickUsableDefaultModelId(
      storedDefaultModel,
      listEnabledVisibleModelIds(catalog, preferences, policy)
    ) ?? DEFAULT_NEW_AGENT_MODEL_ID
  );
}

type ProfileModelSettings = {
  auto_enable_new_models: boolean;
  models_seen_at: string | null;
  default_model?: string | null;
};

async function loadUserModelCatalogState(userId: string) {
  const [
    { data: catalog, error: catalogError },
    { data: preferences, error: preferenceError },
    { data: profile, error: profileError },
  ] = await Promise.all([
    supabaseAdmin
      .from("ai_models")
      .select("id, provider, name, is_available, is_hidden, created_at"),
    supabaseAdmin
      .from("user_model_preferences")
      .select("model_id, is_enabled")
      .eq("user_id", userId),
    supabaseAdmin
      .from("profiles")
      .select("auto_enable_new_models, models_seen_at, default_model")
      .eq("id", userId)
      .single(),
  ]);

  if (catalogError) {
    throw new Error(catalogError.message);
  }

  if (preferenceError) {
    throw new Error(preferenceError.message);
  }

  if (profileError) {
    throw new Error(profileError.message);
  }

  return {
    catalog: (catalog ?? []) as ModelAvailabilityRow[],
    preferences: (preferences ?? []) as UserModelPreferenceRow[],
    policy: buildNewModelDefaultPolicy(profile as ProfileModelSettings | null),
    storedDefaultModel:
      (profile as ProfileModelSettings | null)?.default_model ?? null,
  };
}

export async function resolveUserDefaultModelId(
  userId: string,
  storedDefaultModel: string | null | undefined
) {
  const { catalog, preferences, policy } =
    await loadUserModelCatalogState(userId);
  return resolveUsableDefaultModelId(
    storedDefaultModel,
    catalog,
    preferences,
    policy
  );
}

export type DefaultModelScope = {
  teamId?: string | null;
};

// Predicate for "can this scope actually invoke this model": provider
// reachability (own keys + verified team keys + platform access), member
// capabilities, and the team model allowlist — the same gate /api/models
// applies to its `models` list. Enabled/visible/available filtering happens
// separately in listEnabledVisibleModelIds.
async function loadScopeInvocationPredicate(
  userId: string,
  teamId: string | null
) {
  const [access, capabilities, allowlistState] = await Promise.all([
    loadScopedUserProviderAccess(userId, teamId),
    teamId ? resolveMemberCapabilities(userId, teamId) : Promise.resolve(null),
    teamId
      ? loadTeamAllowlistState(teamId)
      : Promise.resolve({ status: "unrestricted" as const }),
  ]);
  // Throw rather than degrade to "unrestricted". This predicate constrains a
  // default that persistence callers *write* (preset stamping, fork creation),
  // so a fail-open here does not just show a forbidden model once — it freezes
  // one into a stored row. The sibling reads in this module already throw
  // rather than substituting an empty result.
  //
  // Every caller of resolveStoredUserDefaultModelId already handles the throw,
  // checked when this was added:
  //   * writes  — app/api/assignments/route.ts, lib/flows/server.ts: propagate
  //     deliberately (flows/server converts it to a retryable FlowServiceError)
  //   * display — app/api/agents/route.ts, app/api/agents/roster/route.ts,
  //     lib/mogplex-api/agents.ts: already `.catch(() => null)` to the template
  //     model. The last is personal-scope only, so it never reaches this branch.
  if (allowlistState.status === "unknown") {
    // The reason goes to the log, never into the thrown message. This error
    // reaches the browser: lib/flows/server.ts wraps it in a FlowServiceError
    // and app/api/flows/route.ts returns `{ error: message }` to the client,
    // so interpolating it would put raw Postgres text (relation names,
    // constraint names, sometimes query fragments) in front of end users.
    // Same line /api/models draws with its generic 500 body.
    console.error("Model allowlist lookup failed, denying scope default", {
      teamId,
      reason: allowlistState.reason,
    });
    // The same tagged error the invocation gate throws, for the same failure:
    // classification keys off `.code`, and its message is copy written for a
    // user — which matters here because this one reaches the browser, where
    // "Failed to load model allowlist for team <uuid>" would have been both
    // internal-sounding and a needless team-id disclosure.
    throw modelAllowlistUnavailableError();
  }

  const isAllowedModel = teamAllowlistMatcher(allowlistState);
  return (modelId: string) => {
    if (!isModelReachable(modelId, access)) return false;
    if (capabilities && !hasCapability(capabilities, modelCapability(modelId)))
      return false;
    if (!isAllowedModel(modelId)) return false;
    return true;
  };
}

// Same as resolveUserDefaultModelId but reads profiles.default_model itself
// and additionally constrains the result to models the scope can actually
// invoke, so preset stamping and fork persistence never pick a model that
// /api/models would not offer in the same scope. Returns null when the scope
// has no usable models at all — callers must treat that as "no override"
// (display paths label with the template model; fork paths pass the null
// override through so the fork keeps the template model) rather than
// inventing a model the scope cannot invoke. Throws on storage failures —
// persistence callers must not swallow this (a silent fallback would freeze
// the stale template model into an immutable fork).
export async function resolveStoredUserDefaultModelId(
  userId: string,
  scope: DefaultModelScope = {}
): Promise<string | null> {
  const teamId = scope.teamId ?? null;
  const [{ catalog, preferences, policy, storedDefaultModel }, canInvoke] =
    await Promise.all([
      loadUserModelCatalogState(userId),
      loadScopeInvocationPredicate(userId, teamId),
    ]);
  const usableModelIds = listEnabledVisibleModelIds(
    catalog,
    preferences,
    policy
  ).filter(canInvoke);
  return pickUsableDefaultModelId(storedDefaultModel, usableModelIds);
}

// Every model id this scope can actually invoke — enabled, visible, allowed by
// team policy, and backed by a usable credential. Callers that let something
// other than the user pick a model (the flow assistant) must constrain the
// choice to this set: a node's model is now the only source of what a step
// runs on, so an unrecognised id publishes cleanly and fails at run time.
export async function listUsableModelIdsForScope(
  userId: string,
  scope: DefaultModelScope = {}
): Promise<string[]> {
  const [{ catalog, preferences, policy }, canInvoke] = await Promise.all([
    loadUserModelCatalogState(userId),
    loadScopeInvocationPredicate(userId, scope.teamId ?? null),
  ]);
  return listEnabledVisibleModelIds(catalog, preferences, policy).filter(
    canInvoke
  );
}

export async function canUserSetDefaultModel(userId: string, modelId: string) {
  const { catalog, preferences, policy } =
    await loadUserModelCatalogState(userId);
  return isUsableDefaultModelId(modelId, catalog, preferences, policy);
}

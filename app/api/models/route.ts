import { NextResponse } from "next/server";
import { getUserId, requireUserId } from "@/lib/auth";
import { getDefaultNewAgentModel } from "@/lib/agents/model-options";
import { normalizeCatalogModel } from "@/lib/models/catalog-normalization";
import { filterVisibleModelCatalog } from "@/lib/models/catalog-visibility";
import { toCliModelInfoList } from "@/lib/models/cli-format";
import { loadScopedUserProviderAccess } from "@/lib/models/provider-access";
import {
  isModelReachable,
  type UserProviderAccess,
} from "@/lib/models/provider-reachability";
import {
  buildNewModelDefaultPolicy,
  buildUserModelPreferenceMap,
  resolveUserModelEnabledState,
} from "@/lib/models/user-preferences";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  teamAllowlistMatcher,
  hasCapability,
  ALLOWLIST_UNAVAILABLE_RETRY_AFTER_SECONDS,
  loadTeamAllowlistState,
  MODEL_ALLOWLIST_UNAVAILABLE_ERROR,
  modelCapability,
  readActiveTeamIdHeader,
  resolveMemberCapabilities,
} from "@/lib/team-capabilities";
import type {
  EnabledStateModel,
  NewModelDefaultPolicy,
  UserModelPreferenceRow,
} from "@/lib/models/user-preferences";
import type { AIModel } from "@/lib/types";

const CATALOG_SELECT =
  "id, provider, name, context_length, pricing_input, pricing_output, capabilities, is_available, is_hidden, is_recommended, recommendation_bucket, recommendation_rank, recommendation_reason, recommended_at, created_at";

const CATALOG_MUTATION_FIELDS = [
  "provider",
  "name",
  "context_length",
  "capabilities",
  "is_available",
  "is_hidden",
  "pricing_input",
  "pricing_output",
] as const;

type CatalogRow = {
  id: string;
  provider: string;
  name: string;
  context_length: number | null;
  pricing_input: number | null;
  pricing_output: number | null;
  capabilities: string[] | null;
  is_available: boolean;
  is_hidden: boolean;
  is_recommended?: boolean;
  recommendation_bucket?: "open" | "frontier" | null;
  recommendation_rank?: number | null;
  recommendation_reason?: string | null;
  recommended_at?: string | null;
  created_at?: string | null;
};

type ProfileModelSettings = {
  auto_enable_new_models: boolean;
  models_seen_at: string | null;
  default_model?: string | null;
};

type ModelsGetDeps = {
  getUserId: typeof getUserId;
  listAvailableModels: () => Promise<{
    data: CatalogRow[] | null;
    error: { message: string } | null;
  }>;
  listAllModels: () => Promise<{
    data: CatalogRow[] | null;
    error: { message: string } | null;
  }>;
  listUserModelPreferences: (userId: string) => Promise<{
    data: UserModelPreferenceRow[] | null;
    error: { message: string } | null;
  }>;
  loadProfileModelSettings: (userId: string) => Promise<{
    data: ProfileModelSettings | null;
    error: { message: string } | null;
  }>;
  loadUserProviderAccess: (
    userId: string,
    teamId: string | null
  ) => Promise<{
    data: UserProviderAccess | null;
    error: { message: string } | null;
  }>;
  resolveMemberCapabilities: typeof resolveMemberCapabilities;
  loadTeamAllowlistState: typeof loadTeamAllowlistState;
};

type ModelsPatchDeps = {
  requireUserId: typeof requireUserId;
  upsertUserModelPreference: (input: {
    userId: string;
    modelId: string;
    isEnabled: boolean;
  }) => Promise<{ error: { message: string } | null }>;
};

const defaultModelsGetDeps: ModelsGetDeps = {
  getUserId,
  async listAvailableModels() {
    const { data, error } = await supabaseAdmin
      .from("ai_models")
      .select(CATALOG_SELECT)
      .eq("is_available", true)
      .order("provider");

    return {
      data,
      error: error ? { message: error.message } : null,
    };
  },
  async listAllModels() {
    const { data, error } = await supabaseAdmin
      .from("ai_models")
      .select(CATALOG_SELECT)
      .order("provider");

    return {
      data,
      error: error ? { message: error.message } : null,
    };
  },
  async listUserModelPreferences(userId) {
    const { data, error } = await supabaseAdmin
      .from("user_model_preferences")
      .select("model_id, is_enabled")
      .eq("user_id", userId);

    return {
      data,
      error: error ? { message: error.message } : null,
    };
  },
  async loadProfileModelSettings(userId) {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("auto_enable_new_models, models_seen_at, default_model")
      .eq("id", userId)
      .single();

    return {
      data: data as ProfileModelSettings | null,
      error: error ? { message: error.message } : null,
    };
  },
  async loadUserProviderAccess(userId, teamId) {
    // Surface failures rather than swallowing — silently treating the user
    // as "no access" would 200-OK an empty model picker even when keys are
    // configured, masking transient Supabase/Vault outages.
    try {
      return {
        data: await loadScopedUserProviderAccess(userId, teamId),
        error: null,
      };
    } catch (error) {
      return {
        data: null,
        error: {
          message:
            error instanceof Error
              ? error.message
              : "Failed to load provider access",
        },
      };
    }
  },
  resolveMemberCapabilities,
  loadTeamAllowlistState,
};

const defaultModelsPatchDeps: ModelsPatchDeps = {
  requireUserId,
  async upsertUserModelPreference(input) {
    const { error } = await supabaseAdmin.from("user_model_preferences").upsert(
      {
        user_id: input.userId,
        model_id: input.modelId,
        is_enabled: input.isEnabled,
      },
      { onConflict: "user_id,model_id" }
    );

    return {
      error: error ? { message: error.message } : null,
    };
  },
};

// Resolve a model's enabled state (honoring the auto-enable policy) and drop
// the internal created_at input so it does not leak into the response.
function toCatalogEntry<T extends EnabledStateModel>(
  normalized: T,
  prefMap: ReadonlyMap<string, boolean>,
  policy: NewModelDefaultPolicy
) {
  const is_enabled = resolveUserModelEnabledState(normalized, prefMap, policy);
  const { created_at: _created_at, ...model } = normalized;
  return { ...model, is_enabled };
}

export function createModelsGetHandler(overrides: Partial<ModelsGetDeps> = {}) {
  const deps: ModelsGetDeps = {
    ...defaultModelsGetDeps,
    ...overrides,
  };

  return async function GET(request?: Request) {
    const format = readModelsFormat(request);
    const userId = await deps.getUserId();
    const teamId = request ? readActiveTeamIdHeader(request) : null;

    if (!userId) {
      const { data, error } = await deps.listAvailableModels();

      if (error)
        return NextResponse.json({ error: error.message }, { status: 500 });

      // `created_at` is an internal resolution input; keep it out of the wire.
      const visibleCatalog = filterVisibleModelCatalog(
        (data ?? []).map(normalizeCatalogModel)
      ).map(({ created_at: _created_at, ...model }) => model);
      if (format === "cli") {
        return NextResponse.json(
          toCliModelInfoList(visibleCatalog as AIModel[])
        );
      }
      return NextResponse.json({
        models: visibleCatalog,
        catalog: visibleCatalog,
      });
    }

    const [
      { data: allModels, error: modelsErr },
      { data: prefs, error: prefsErr },
      { data: profileSettings, error: profileErr },
      { data: providerAccess, error: providerAccessErr },
      capabilities,
      allowlistState,
    ] = await Promise.all([
      deps.listAllModels(),
      deps.listUserModelPreferences(userId),
      deps.loadProfileModelSettings(userId),
      deps.loadUserProviderAccess(userId, teamId),
      teamId
        ? deps.resolveMemberCapabilities(userId, teamId)
        : Promise.resolve(null),
      teamId
        ? deps.loadTeamAllowlistState(teamId)
        : Promise.resolve({ status: "unrestricted" as const }),
    ]);

    if (modelsErr)
      return NextResponse.json({ error: modelsErr.message }, { status: 500 });
    if (prefsErr)
      return NextResponse.json({ error: prefsErr.message }, { status: 500 });
    if (profileErr)
      return NextResponse.json({ error: profileErr.message }, { status: 500 });
    if (providerAccessErr || !providerAccess)
      return NextResponse.json(
        {
          error: providerAccessErr?.message ?? "Failed to load provider access",
        },
        { status: 500 }
      );
    // Fails rather than degrading to "unrestricted": this response drives the
    // model pickers, so a fail-open would offer models the team forbids — which
    // the invocation gate then rejects, presenting a transient read error as a
    // permissions problem.
    //
    // An earlier revision returned the settings `catalog` alongside the error so
    // an admin could still open the page they would use to fix the allowlist.
    // Removed: fetchJsonObject throws on a non-ok response and discards the
    // body, so nothing could read it — building it was pure cost on an already
    // degraded path. `allowlistUnavailable` stays because it is free, and #769
    // tracks teaching the client to surface it (and new-arrivals' `degraded`)
    // so that operability argument can actually be delivered.
    if (allowlistState.status === "unknown") {
      return NextResponse.json(
        {
          error: MODEL_ALLOWLIST_UNAVAILABLE_ERROR,
          allowlistUnavailable: true,
        },
        {
          status: 503,
          headers: {
            "Retry-After": String(ALLOWLIST_UNAVAILABLE_RETRY_AFTER_SECONDS),
          },
        }
      );
    }

    const prefMap = buildUserModelPreferenceMap(prefs ?? []);
    // Apply the user's auto-enable-off switch in the resolution path so a new
    // model is not served as enabled before the new-arrivals hook reconciles.
    const policy = buildNewModelDefaultPolicy(profileSettings);

    const catalog = (allModels ?? [])
      .map(normalizeCatalogModel)
      .map((model) => toCatalogEntry(model, prefMap, policy));

    const visibleCatalog = filterVisibleModelCatalog(catalog);
    // `models` drives agent/flow model pickers — only surface ones the user
    // can actually invoke given their provider keys + platform access. The
    // full `catalog` is returned untouched so settings can keep showing
    // every model with toggles.
    // Built once: this filter and the CLI one below run the whole catalog.
    const isAllowedModel = teamAllowlistMatcher(allowlistState);
    const models = visibleCatalog.filter((model) => {
      if (!model.is_enabled) return false;
      if (!isModelReachable(model.id, providerAccess)) return false;
      if (
        capabilities &&
        !hasCapability(capabilities, modelCapability(model.id))
      )
        return false;
      if (!isAllowedModel(model.id)) return false;
      return true;
    });

    if (format === "cli") {
      // CLI picker parity with the web UI: show every reachable model the
      // user has not disabled — honoring both explicit disables and the
      // auto-enable-off default for new models via the shared `is_enabled`
      // resolution. Exclude hidden/deprecated rows and require `is_available`
      // for the CLI picker.
      const cliModels = visibleCatalog.filter((model) => {
        if (!model.is_enabled) return false;
        if (!isModelReachable(model.id, providerAccess)) return false;
        if (
          capabilities &&
          !hasCapability(capabilities, modelCapability(model.id))
        )
          return false;
        if (!isAllowedModel(model.id)) return false;
        return model.is_available;
      });
      return NextResponse.json(toCliModelInfoList(cliModels as AIModel[]));
    }

    // The user's default model, constrained to what this scope can actually
    // invoke (enabled + reachable + team allowlist). Falls back through the
    // static default to the first selectable model when the stored default is
    // not usable here.
    const defaultModel = getDefaultNewAgentModel(
      models as AIModel[],
      profileSettings?.default_model ?? null
    );

    return NextResponse.json({
      models,
      catalog,
      default_model: defaultModel || null,
    });
  };
}

function readModelsFormat(request?: Request): "cli" | null {
  if (!request) return null;
  try {
    const { searchParams } = new URL(request.url);
    return searchParams.get("format") === "cli" ? "cli" : null;
  } catch {
    return null;
  }
}

export const GET = createModelsGetHandler();

export function createModelsPatchHandler(
  overrides: Partial<ModelsPatchDeps> = {}
) {
  const deps: ModelsPatchDeps = {
    ...defaultModelsPatchDeps,
    ...overrides,
  };

  return async function PATCH(request: Request) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    const body = (await request.json()) as Record<string, unknown>;
    const modelId = typeof body.model_id === "string" ? body.model_id : "";
    const isEnabled = body.is_enabled;

    if (!modelId || typeof isEnabled !== "boolean") {
      return NextResponse.json(
        { error: "model_id and is_enabled required" },
        { status: 400 }
      );
    }

    const hasCatalogMutationFields = CATALOG_MUTATION_FIELDS.some(
      (field) => field in body
    );
    if (hasCatalogMutationFields) {
      return NextResponse.json(
        {
          error:
            "Global model catalog updates are not allowed from /api/models. Use the sync-models cron instead.",
        },
        { status: 400 }
      );
    }

    const { error } = await deps.upsertUserModelPreference({
      userId,
      modelId,
      isEnabled,
    });

    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  };
}

export const PATCH = createModelsPatchHandler();

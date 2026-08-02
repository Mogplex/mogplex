import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { filterVisibleModelCatalog } from "@/lib/models/catalog-visibility";
import {
  buildNewModelDefaultPolicy,
  buildUserModelPreferenceMap,
  resolveUserModelEnabledState,
} from "@/lib/models/user-preferences";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOwnedRepo } from "@/lib/repos";
import type {
  NewModelDefaultPolicy,
  UserModelPreferenceRow,
} from "@/lib/models/user-preferences";
import type { NextRequest } from "next/server";

type RouteContext = { params: Promise<{ id: string }> };

type CatalogRow = {
  id: string;
  provider: string;
  name: string;
  context_length: number | null;
  capabilities: string[] | null;
  is_available: boolean;
  is_hidden: boolean;
  created_at?: string | null;
};

type ProfileModelSettings = {
  auto_enable_new_models: boolean;
  models_seen_at: string | null;
};

type RepoModelOverrideRow = {
  model_id: string;
  excluded: boolean;
};

type RepoModelsGetDeps = {
  requireUserId: typeof requireUserId;
  getOwnedRepo: typeof getOwnedRepo;
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
  listRepoModelOverrides: (repoId: string) => Promise<{
    data: RepoModelOverrideRow[] | null;
    error: { message: string } | null;
  }>;
};

const defaultRepoModelsGetDeps: RepoModelsGetDeps = {
  requireUserId,
  getOwnedRepo,
  async listAllModels() {
    const { data, error } = await supabaseAdmin
      .from("ai_models")
      .select(
        "id, provider, name, context_length, capabilities, is_available, is_hidden, created_at"
      )
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
      .select("auto_enable_new_models, models_seen_at")
      .eq("id", userId)
      .single();

    return {
      data: data as ProfileModelSettings | null,
      error: error ? { message: error.message } : null,
    };
  },
  async listRepoModelOverrides(repoId) {
    const { data, error } = await supabaseAdmin
      .from("repo_model_overrides")
      .select("model_id, excluded")
      .eq("repo_id", repoId);

    return {
      data,
      error: error ? { message: error.message } : null,
    };
  },
};

function firstLoadError(
  results: ReadonlyArray<{ error: { message: string } | null }>
): NextResponse | null {
  for (const result of results) {
    if (result.error)
      return NextResponse.json(
        { error: result.error.message },
        { status: 500 }
      );
  }
  return null;
}

/** Resolved models for a repo: user-enabled models minus repo-excluded */
export function createRepoModelsGetHandler(
  overrides: Partial<RepoModelsGetDeps> = {}
) {
  const deps: RepoModelsGetDeps = {
    ...defaultRepoModelsGetDeps,
    ...overrides,
  };

  return async function GET(_req: NextRequest, ctx: RouteContext) {
    const { id: repoId } = await ctx.params;
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;
    const repo = await deps.getOwnedRepo(repoId, userId);
    if (!repo)
      return NextResponse.json({ error: "Repo not found" }, { status: 404 });

    const [allModelsRes, prefsRes, profileRes, overridesRes] =
      await Promise.all([
        deps.listAllModels(),
        deps.listUserModelPreferences(userId),
        deps.loadProfileModelSettings(userId),
        deps.listRepoModelOverrides(repoId),
      ]);

    const loadError = firstLoadError([
      allModelsRes,
      prefsRes,
      profileRes,
      overridesRes,
    ]);
    if (loadError) return loadError;

    const overrides = overridesRes.data ?? [];
    // Honor the auto-enable-off switch here too: a new model must not leak
    // into a repo's resolved model set before the new-arrivals hook pins it.
    const resolved = resolveRepoModels(
      allModelsRes.data ?? [],
      buildUserModelPreferenceMap(prefsRes.data ?? []),
      buildNewModelDefaultPolicy(profileRes.data),
      overrides
    );

    return NextResponse.json({ models: resolved, overrides });
  };
}

function resolveRepoModels(
  allModels: CatalogRow[],
  prefMap: ReadonlyMap<string, boolean>,
  policy: NewModelDefaultPolicy,
  overrides: RepoModelOverrideRow[]
) {
  const excludedSet = new Set(
    overrides.filter((override) => override.excluded).map((o) => o.model_id)
  );

  return (
    filterVisibleModelCatalog(allModels)
      .filter((model) => resolveUserModelEnabledState(model, prefMap, policy))
      .filter((model) => !excludedSet.has(model.id))
      // Strip the internal created_at resolution input from the wire shape.
      .map(({ created_at: _created_at, ...model }) => ({
        ...model,
        is_enabled: true,
      }))
  );
}

export const GET = createRepoModelsGetHandler();

/** Exclude/include a model for this repo */
export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id: repoId } = await ctx.params;
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;
  const repo = await getOwnedRepo(repoId, userId);
  if (!repo)
    return NextResponse.json({ error: "Repo not found" }, { status: 404 });

  const { model_id, excluded } = await req.json();
  if (!model_id || typeof excluded !== "boolean") {
    return NextResponse.json(
      { error: "model_id and excluded required" },
      { status: 400 }
    );
  }

  if (excluded) {
    const { error } = await supabaseAdmin
      .from("repo_model_overrides")
      .upsert(
        { repo_id: repoId, model_id, excluded },
        { onConflict: "repo_id,model_id" }
      );
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    // Remove the override (un-exclude)
    await supabaseAdmin
      .from("repo_model_overrides")
      .delete()
      .eq("repo_id", repoId)
      .eq("model_id", model_id);
  }

  return NextResponse.json({ ok: true });
}

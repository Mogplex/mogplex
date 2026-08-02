import { normalizeCatalogModel } from "@/lib/models/catalog-normalization";
import { filterVisibleModelCatalog } from "@/lib/models/catalog-visibility";
import {
  buildUserProviderAccess,
  isModelReachable,
} from "@/lib/models/provider-reachability";
import {
  buildNewModelDefaultPolicy,
  buildUserModelPreferenceMap,
  resolveUserModelEnabledState,
} from "@/lib/models/user-preferences";
import { loadUserPlatformAccess } from "@/lib/platform-access";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { listProviderKeys } from "@/lib/vault";
import type { UserModelPreferenceRow } from "@/lib/models/user-preferences";

const MODEL_SELECT =
  "id, provider, name, context_length, pricing_input, pricing_output, capabilities, is_available, is_hidden, is_recommended, recommendation_bucket, recommendation_rank, recommendation_reason, recommended_at, created_at";

type ProfileModelSettings = {
  auto_enable_new_models: boolean;
  models_seen_at: string | null;
};

export type MogplexApiModel = {
  id: string;
  provider: string;
  name: string;
  contextLength: number | null;
  capabilities: string[];
  pricing: {
    input: number | null;
    output: number | null;
  };
};

export async function listMogplexApiModels(
  userId: string
): Promise<MogplexApiModel[]> {
  const [catalogResult, preferencesResult, profileResult, keys, platform] =
    await Promise.all([
      supabaseAdmin.from("ai_models").select(MODEL_SELECT).order("provider"),
      supabaseAdmin
        .from("user_model_preferences")
        .select("model_id, is_enabled")
        .eq("user_id", userId),
      supabaseAdmin
        .from("profiles")
        .select("auto_enable_new_models, models_seen_at")
        .eq("id", userId)
        .single(),
      listProviderKeys(userId),
      loadUserPlatformAccess(userId),
    ]);

  if (catalogResult.error) throw new Error(catalogResult.error.message);
  if (preferencesResult.error) throw new Error(preferencesResult.error.message);
  if (profileResult.error) throw new Error(profileResult.error.message);

  const preferenceMap = buildUserModelPreferenceMap(
    (preferencesResult.data ?? []) as UserModelPreferenceRow[]
  );
  const policy = buildNewModelDefaultPolicy(
    profileResult.data as ProfileModelSettings | null
  );
  const providerAccess = buildUserProviderAccess(
    new Set(keys.map((key) => key.provider)),
    { allowPlatformAi: platform.allowPlatformAi }
  );

  return filterVisibleModelCatalog(
    (catalogResult.data ?? []).map(normalizeCatalogModel)
  )
    .filter(
      (model) =>
        model.is_available &&
        resolveUserModelEnabledState(model, preferenceMap, policy) &&
        isModelReachable(model.id, providerAccess)
    )
    .map((model) => ({
      id: model.id,
      provider: model.provider,
      name: model.name,
      contextLength: model.context_length,
      capabilities: model.capabilities ?? [],
      pricing: {
        input: model.pricing_input,
        output: model.pricing_output,
      },
    }));
}

export async function isMogplexApiModelAvailable(
  userId: string,
  modelId: string
) {
  const models = await listMogplexApiModels(userId);
  return models.some((model) => model.id === modelId);
}

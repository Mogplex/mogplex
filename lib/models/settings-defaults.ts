import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  listUsableModelIdsForScope,
  resolveUserDefaultModelId,
} from "@/lib/models/default-model";
import {
  surfaceDefaultModel,
  MODEL_SURFACES,
  type ModelSurface,
} from "@/lib/models/surface-defaults";

export type ModelSettingsTargets = {
  surfaces: { id: ModelSurface; model: string | null }[];
  automations: { id: string; name: string }[];
};

export async function loadModelSettingsTargets(
  userId: string
): Promise<ModelSettingsTargets> {
  const [profile, flows] = await Promise.all([
    supabaseAdmin
      .from("profiles")
      .select("default_model, surface_models")
      .eq("id", userId)
      .single(),
    supabaseAdmin
      .from("flows")
      .select("id, name")
      .eq("user_id", userId)
      .order("name"),
  ]);
  if (profile.error || flows.error)
    throw new Error("Unable to load model destinations");
  return {
    surfaces: MODEL_SURFACES.map((id) => ({
      id,
      model: surfaceDefaultModel(profile.data, id),
    })),
    automations: flows.data ?? [],
  };
}

export type ApplyModelDefaultsInput = {
  userId: string;
  model: string;
  surfaces: ModelSurface[];
  flowIds: string[];
  theme?: string;
};

export class ModelSettingsError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

export async function applyModelDefaults(input: ApplyModelDefaultsInput) {
  const { data: profile, error } = await supabaseAdmin
    .from("profiles")
    .select("default_model")
    .eq("id", input.userId)
    .single();
  if (error || !profile)
    throw new ModelSettingsError("Unable to load model settings", 500);
  const previousResolved = await resolveUserDefaultModelId(
    input.userId,
    profile.default_model
  );
  if (input.flowIds.length > 0) {
    const { data: flows, error: flowError } = await supabaseAdmin
      .from("flows")
      .select("id")
      .eq("user_id", input.userId)
      .in("id", input.flowIds);
    if (flowError)
      throw new ModelSettingsError("Unable to load automations", 500);
    if (flows?.length !== input.flowIds.length)
      throw new ModelSettingsError(
        "An automation is no longer available. Reload and try again.",
        400
      );
    // Flows belong to a user, not a team. The executing repository supplies
    // team scope at run time, where its invocation policy is enforced.
    const models = await listUsableModelIdsForScope(input.userId);
    if (!models.includes(input.model))
      throw new ModelSettingsError(
        "This model is unavailable for your account.",
        400
      );
  }
  const result = await supabaseAdmin.rpc("apply_model_defaults", {
    p_user_id: input.userId,
    p_next_model: input.model,
    p_expected_model: profile.default_model,
    p_previous_resolved: previousResolved,
    p_surfaces: input.surfaces,
    p_flow_ids: input.flowIds,
    p_theme: input.theme ?? null,
  });
  if (result.error) {
    if (result.error.code === "40001")
      throw new ModelSettingsError(
        "Settings changed while saving. Reload and try again.",
        409
      );
    console.error("Model settings save failed", { code: result.error.code });
    throw new ModelSettingsError(
      "Unable to save model settings. No changes were applied.",
      500
    );
  }
  return result.data as { drafts_updated: number; versions_published: number };
}

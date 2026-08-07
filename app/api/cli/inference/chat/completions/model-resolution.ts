import { resolveUserDefaultModelId } from "@/lib/models/default-model";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function resolveCliModelId(
  userId: string,
  requestedModel?: string | null
): Promise<string> {
  const explicitModel = requestedModel?.trim();
  if (explicitModel) {
    const resolved = await resolveExplicitCliModelId(explicitModel);
    if (resolved) return resolved;
  }

  const { data: profile, error } = await supabaseAdmin
    .from("profiles")
    .select("default_model")
    .eq("id", userId)
    .single();
  if (error) {
    throw new Error(error.message);
  }
  const fallback = await resolveUserDefaultModelId(
    userId,
    profile?.default_model
  );
  if (!fallback) {
    throw new Error("No enabled model is configured for this account.");
  }
  return fallback;
}

async function resolveExplicitCliModelId(
  modelId: string
): Promise<string | null> {
  if (modelId.includes("/")) return modelId;
  const { data: catalogRow } = await supabaseAdmin
    .from("ai_models")
    .select("provider")
    .eq("id", modelId)
    .maybeSingle();
  if (typeof catalogRow?.provider === "string") {
    return `${catalogRow.provider}/${modelId}`;
  }
  // Bare slug with no catalog match — treat as unresolved so the caller
  // can fall back to the user's configured default. Older CLI versions
  // ship hardcoded bare defaults (e.g. "claude-opus-4-7") that never match
  // the canonical `provider/model-id` shape of `ai_models.id`; without this
  // fallback those requests are forwarded to the Vercel AI Gateway, which
  // rejects them with a 500 that surfaces in the CLI as an opaque
  // "Internal server error".
  return null;
}

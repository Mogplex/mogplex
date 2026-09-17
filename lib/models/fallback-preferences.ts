import { supabaseAdmin } from "@/lib/supabase/admin";
import { listUsableModelIdsForScope } from "@/lib/models/default-model";

export function parseFallbackModelIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (
    !value.every(
      (id): id is string =>
        typeof id === "string" &&
        id.trim() === id &&
        id.length > 0 &&
        id.length <= 255 &&
        id.includes("/") &&
        !id.startsWith("openrouter/")
    )
  )
    return null;
  return new Set(value).size === value.length ? value : null;
}

export async function loadFallbackModelPreference(
  userId: string
): Promise<string[] | null> {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("fallback_model_ids")
    .eq("id", userId)
    .single();
  if (error || !data) throw new Error("Unable to load fallback models");
  if (data.fallback_model_ids == null) return null;
  const ids = parseFallbackModelIds(data.fallback_model_ids);
  if (!ids) throw new Error("Invalid saved fallback models");
  return ids;
}

// Re-check availability at invocation: a saved choice may since be disabled,
// retired, or forbidden in the active team. Preserve the user's order.
export async function loadUsableFallbackModelIds(
  userId: string,
  teamId?: string | null
): Promise<string[] | null> {
  const ids = await loadFallbackModelPreference(userId);
  if (!ids?.length) return ids;
  const usable = new Set(await listUsableModelIdsForScope(userId, { teamId }));
  return ids.filter((id) => usable.has(id));
}

export async function saveFallbackModelPreference(
  userId: string,
  modelIds: string[]
) {
  const { error } = await supabaseAdmin
    .from("profiles")
    .update({ fallback_model_ids: modelIds })
    .eq("id", userId)
    .select("id")
    .single();
  if (error) throw new Error("Unable to save fallback models");
}

import { PRECONFIGURED_AGENTS } from "@/lib/agents/templates";
import { resolveStoredUserDefaultModelId } from "@/lib/models/default-model";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type MogplexApiAgent = {
  id: string;
  name: string;
  slug: string | null;
  model: string;
  description: string | null;
  category: string | null;
  preset: boolean;
};

export async function listMogplexApiAgents(
  userId: string
): Promise<MogplexApiAgent[]> {
  const [{ data, error }, defaultModelId] = await Promise.all([
    supabaseAdmin
      .from("agents")
      .select("id, name, slug, model, description, category, source_template")
      .eq("user_id", userId)
      .order("name")
      .limit(200),
    // Presets follow the user's default model, same as /api/agents. The v1
    // API is key-scoped to a user and carries no team header, so this is
    // personal-scope resolution. Display-only — fall back to the template
    // model if resolution fails.
    resolveStoredUserDefaultModelId(userId).catch(() => null),
  ]);
  if (error) throw new Error(error.message);

  const forkedTemplates = new Set(
    (data ?? [])
      .map((agent) => agent.source_template)
      .filter((value): value is string => typeof value === "string")
  );
  const presets = PRECONFIGURED_AGENTS.filter(
    (template) => !forkedTemplates.has(template.name)
  ).map((template) => ({
    id: `preset:${template.name}`,
    name: template.name,
    slug: null,
    model: defaultModelId || template.model,
    description: template.description ?? null,
    category: template.category ?? null,
    preset: true,
  }));
  const agents = (data ?? []).map((agent) => ({
    id: agent.id,
    name: agent.name,
    slug: agent.slug,
    model: agent.model,
    description: agent.description ?? null,
    category: agent.category ?? null,
    preset: false,
  }));

  return [...presets, ...agents];
}

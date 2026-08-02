import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUserId } from "@/lib/auth";
import { AGENT_CATEGORIES, PRECONFIGURED_AGENTS } from "@/lib/agents/templates";
import { resolveStoredUserDefaultModelId } from "@/lib/models/default-model";
import { readActiveTeamIdHeader } from "@/lib/team-capabilities";
import { validateAgentInput } from "@/lib/agents/validation";
import {
  AGENT_CREATE_FIELDS,
  AGENT_UPDATE_FIELDS,
  pickAgentFields,
} from "@/lib/agents/input-sanitizer";

const BUILT_IN_CATEGORY_SLUGS = new Set(Object.keys(AGENT_CATEGORIES));

type CategoryCheckError = { message: string; status: 400 | 500 };

async function ensureCategoryAllowed(
  userId: string,
  category: string | undefined
): Promise<CategoryCheckError | null> {
  if (!category) return null;
  if (BUILT_IN_CATEGORY_SLUGS.has(category)) return null;
  const { data, error } = await supabaseAdmin
    .from("agent_categories")
    .select("id")
    .eq("user_id", userId)
    .eq("slug", category)
    .maybeSingle();
  if (error) return { message: error.message, status: 500 };
  if (!data) return { message: "Invalid category", status: 400 };
  return null;
}

export async function GET(req: Request) {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  const [{ data, error }, defaultModelId] = await Promise.all([
    supabaseAdmin.from("agents").select("*").eq("user_id", userId).limit(200),
    // Presets follow the user's current default model rather than the static
    // template constant, which goes stale as the catalog syncs. Scoped to the
    // active team (allowlist/capabilities/keys) so the stamped model matches
    // what /api/models offers in the same scope. This is display-only data —
    // fall back to the template model if resolution fails.
    resolveStoredUserDefaultModelId(userId, {
      teamId: readActiveTeamIdHeader(req),
    }).catch(() => null),
  ]);

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  const forkedTemplates = new Set(
    (data ?? [])
      .filter((a: { source_template?: string | null }) => a.source_template)
      .map((a: { source_template?: string | null }) => a.source_template)
  );

  const presetAgents = PRECONFIGURED_AGENTS.map((t) => ({
    id: `preset:${t.name}`,
    user_id: userId,
    name: t.name,
    model: defaultModelId || t.model,
    system_prompt: t.system_prompt,
    description: t.description,
    category: t.category,
    source_template: t.name,
    created_at: new Date(0).toISOString(),
    is_preset: true,
    has_fork: forkedTemplates.has(t.name),
  }));

  return NextResponse.json([...presetAgents, ...(data ?? [])]);
}

export async function POST(req: Request) {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  const body = await req.json().catch(() => null);
  const insertData = pickAgentFields(body, AGENT_CREATE_FIELDS);

  const createValidationError = validateAgentInput({
    name: insertData.name,
    description: insertData.description,
    category: insertData.category,
    systemPrompt: insertData.system_prompt,
    model: insertData.model,
    requireName: true,
    requireModel: true,
    requireCategory: true,
  });
  if (createValidationError) {
    return NextResponse.json({ error: createValidationError }, { status: 400 });
  }

  const categoryError = await ensureCategoryAllowed(
    userId,
    typeof insertData.category === "string" ? insertData.category : undefined
  );
  if (categoryError) {
    return NextResponse.json(
      { error: categoryError.message },
      { status: categoryError.status }
    );
  }

  const { data, error } = await supabaseAdmin
    .from("agents")
    .insert({ ...insertData, user_id: userId })
    .select()
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function PUT(req: Request) {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  const body = await req.json().catch(() => null);
  const rawId =
    body && typeof body === "object"
      ? (body as Record<string, unknown>).id
      : undefined;
  if (typeof rawId !== "string" || rawId.trim().length === 0) {
    return NextResponse.json({ error: "Invalid agent id" }, { status: 400 });
  }
  const id = rawId;
  const updates = pickAgentFields(body, AGENT_UPDATE_FIELDS);

  const updateValidationError = validateAgentInput({
    name: updates.name,
    description: updates.description,
    category: updates.category,
    systemPrompt: updates.system_prompt,
    model: updates.model,
    requireName: updates.name !== undefined,
    requireModel: updates.model !== undefined,
    requireCategory: updates.category !== undefined,
  });
  if (updateValidationError) {
    return NextResponse.json({ error: updateValidationError }, { status: 400 });
  }

  if (updates.category !== undefined) {
    const categoryError = await ensureCategoryAllowed(
      userId,
      typeof updates.category === "string" ? updates.category : undefined
    );
    if (categoryError) {
      return NextResponse.json(
        { error: categoryError.message },
        { status: categoryError.status }
      );
    }
  }

  const { data, error } = await supabaseAdmin
    .from("agents")
    .update(updates)
    .eq("id", id)
    .eq("user_id", userId)
    .select()
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: Request) {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const { error } = await supabaseAdmin
    .from("agents")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

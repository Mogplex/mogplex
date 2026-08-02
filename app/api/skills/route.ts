import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUserId } from "@/lib/auth";
import { GLOBAL_SKILL_SCOPE, type SkillScope } from "@/lib/skills";

function withGlobalScope<T extends object>(
  skill: T
): T & { scope: SkillScope } {
  return { ...skill, scope: GLOBAL_SKILL_SCOPE };
}

export function createScopedSkillResponse<T extends object>(skill: T | null) {
  if (!skill) {
    return NextResponse.json({ error: "Skill not found" }, { status: 404 });
  }

  return NextResponse.json(withGlobalScope(skill));
}

export async function GET(req: Request) {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q");

  let query = supabaseAdmin
    .from("skills")
    .select(
      "id, name, description, content, is_public, tags, usage_count, created_at, updated_at"
    )
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(200);

  if (q) query = query.ilike("name", `%${q}%`);

  const { data, error } = await query;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json((data ?? []).map(withGlobalScope));
}

export async function POST(req: Request) {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  const body = await req.json();
  const { data, error } = await supabaseAdmin
    .from("skills")
    .insert({ ...body, user_id: userId })
    .select()
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return createScopedSkillResponse(data);
}

export async function PUT(req: Request) {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  const body = await req.json();
  const { id, ...updates } = body;

  const { data, error } = await supabaseAdmin
    .from("skills")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId)
    .select()
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return createScopedSkillResponse(data);
}

export async function DELETE(req: Request) {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const { error } = await supabaseAdmin
    .from("skills")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

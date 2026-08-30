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

const SKILL_TYPES = new Set(["runbook", "tool", "prompt", "workflow"]);

export function pickSkillWriteFields(input: unknown) {
  const fields: Record<string, unknown> = {};
  if (!input || typeof input !== "object" || Array.isArray(input))
    return fields;
  const body = input as Record<string, unknown>;
  if (typeof body.name === "string") fields.name = body.name;
  if (body.description === null || typeof body.description === "string") {
    fields.description = body.description;
  }
  if (typeof body.content === "string") fields.content = body.content;
  if (typeof body.type === "string" && SKILL_TYPES.has(body.type)) {
    fields.type = body.type;
  }
  if (typeof body.model === "string") fields.model = body.model;
  if (typeof body.is_public === "boolean") fields.is_public = body.is_public;
  if (
    Array.isArray(body.tags) &&
    body.tags.every((tag) => typeof tag === "string")
  ) {
    fields.tags = body.tags;
  }
  return fields;
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

  const body = await req.json().catch(() => null);
  const fields = pickSkillWriteFields(body);
  if (typeof fields.name !== "string" || typeof fields.content !== "string") {
    return NextResponse.json(
      { error: "name and content are required" },
      { status: 400 }
    );
  }
  const { data, error } = await supabaseAdmin
    .from("skills")
    .insert({ ...fields, user_id: userId })
    .select()
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return createScopedSkillResponse(data);
}

export async function PUT(req: Request) {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  const body = await req.json().catch(() => null);
  const id =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>).id
      : null;
  if (typeof id !== "string" || !id.trim()) {
    return NextResponse.json({ error: "Invalid skill id" }, { status: 400 });
  }
  const updates = pickSkillWriteFields(body);
  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: "No valid fields to update" },
      { status: 400 }
    );
  }

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

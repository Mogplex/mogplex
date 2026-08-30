import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUserId } from "@/lib/auth";

export function pickRuleWriteFields(input: unknown) {
  const fields: Record<string, unknown> = {};
  if (!input || typeof input !== "object" || Array.isArray(input))
    return fields;
  const body = input as Record<string, unknown>;
  if (typeof body.name === "string") fields.name = body.name;
  if (typeof body.content === "string") fields.content = body.content;
  if (typeof body.type === "string") fields.type = body.type;
  return fields;
}

export async function GET(req: Request) {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  const { searchParams } = new URL(req.url);
  const table =
    searchParams.get("table") === "agent_skills"
      ? "agent_skills"
      : "agent_rules";

  const { data, error } = await supabaseAdmin
    .from(table)
    .select("*")
    .eq("user_id", userId);

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: Request) {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  const body = await req.json().catch(() => null);
  const table =
    body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    (body as Record<string, unknown>).table === "agent_skills"
      ? "agent_skills"
      : "agent_rules";
  const fields = pickRuleWriteFields(body);
  if (typeof fields.name !== "string") {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from(table)
    .insert({ ...fields, user_id: userId })
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
  const record =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  const table =
    record?.table === "agent_skills" ? "agent_skills" : "agent_rules";
  const id = record?.id;
  if (typeof id !== "string" || !id.trim()) {
    return NextResponse.json({ error: "Invalid rule id" }, { status: 400 });
  }
  const updates = pickRuleWriteFields(record);
  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: "No valid fields to update" },
      { status: 400 }
    );
  }

  const { data, error } = await supabaseAdmin
    .from(table)
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
  const table =
    searchParams.get("table") === "agent_skills"
      ? "agent_skills"
      : "agent_rules";
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const { error } = await supabaseAdmin
    .from(table)
    .delete()
    .eq("id", id)
    .eq("user_id", userId);

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUserId } from "@/lib/auth";

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

  const body = await req.json();
  const table = body.table === "agent_skills" ? "agent_skills" : "agent_rules";
  const { table: _, ...fields } = body;

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

  const body = await req.json();
  const table = body.table === "agent_skills" ? "agent_skills" : "agent_rules";
  const { id, table: _, ...updates } = body;

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

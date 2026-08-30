import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUserId } from "@/lib/auth";

export function pickCommandCreateFields(input: unknown) {
  const fields: Record<string, unknown> = {};
  if (!input || typeof input !== "object" || Array.isArray(input))
    return fields;
  const body = input as Record<string, unknown>;
  if (typeof body.name === "string") fields.name = body.name;
  if (typeof body.description === "string") {
    fields.description = body.description;
  }
  if (typeof body.template === "string") fields.template = body.template;
  return fields;
}

export async function GET() {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  const { data, error } = await supabaseAdmin
    .from("custom_commands")
    .select("*")
    .eq("user_id", userId)
    .limit(100);

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: Request) {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  const body = await req.json().catch(() => null);
  const fields = pickCommandCreateFields(body);
  if (typeof fields.name !== "string" || typeof fields.template !== "string") {
    return NextResponse.json(
      { error: "name and template are required" },
      { status: 400 }
    );
  }
  const { data, error } = await supabaseAdmin
    .from("custom_commands")
    .insert({ ...fields, user_id: userId })
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
    .from("custom_commands")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

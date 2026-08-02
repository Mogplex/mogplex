import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUserId } from "@/lib/auth";

async function getConversationRecord(id: string, userId: string) {
  const { data, error } = await supabaseAdmin
    .from("conversations")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function GET(req: Request) {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (id) {
    const { data } = await supabaseAdmin
      .from("conversations")
      .select("*")
      .eq("id", id)
      .eq("user_id", userId)
      .single();

    return NextResponse.json(data);
  }

  const { data } = await supabaseAdmin
    .from("conversations")
    .select("id, user_id, model, mode, title, created_at, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(200);

  return NextResponse.json(data || []);
}

export async function PUT(req: Request) {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  const body = await req.json();
  const {
    id,
    expected_updated_at: expectedUpdatedAt,
    ...fields
  } = body as {
    id?: string;
    expected_updated_at?: string | null;
    model?: string;
    mode?: string;
    messages?: unknown;
    local_msgs?: unknown;
    harness_state?: unknown;
    title?: string | null;
  };

  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const updatedAt = new Date().toISOString();
  const updatePayload = {
    ...fields,
    updated_at: updatedAt,
  };

  if (typeof expectedUpdatedAt === "string" && expectedUpdatedAt) {
    const { data, error } = await supabaseAdmin
      .from("conversations")
      .update(updatePayload)
      .eq("id", id)
      .eq("user_id", userId)
      .eq("updated_at", expectedUpdatedAt)
      .select("*")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data) {
      const current = await getConversationRecord(id, userId);
      return NextResponse.json(
        { error: "CONFLICT", conversation: current },
        { status: 409 }
      );
    }

    return NextResponse.json({ ok: true, conversation: data });
  }

  const { data, error } = await supabaseAdmin
    .from("conversations")
    .insert({
      id,
      user_id: userId,
      ...updatePayload,
    })
    .select("*")
    .maybeSingle();

  if (error?.code === "23505") {
    const current = await getConversationRecord(id, userId);
    return NextResponse.json(
      { error: "CONFLICT", conversation: current },
      { status: 409 }
    );
  }

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message || "Failed to save conversation" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, conversation: data });
}

export async function DELETE(req: Request) {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const { error } = await supabaseAdmin
    .from("conversations")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

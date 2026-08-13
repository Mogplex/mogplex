import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUserId } from "@/lib/auth";
import { parseControlSessionRepoId } from "@/lib/control/session-project";
import { pickControlSessionUpdateFields } from "@/lib/control/session-update";

const LIST_COLUMNS =
  "id, title, project, repo_id, pinned, archived, created_at, updated_at";

async function getSessionRecord(id: string, userId: string) {
  const { data, error } = await supabaseAdmin
    .from("control_sessions")
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
    const data = await getSessionRecord(id, userId);
    if (!data) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(data);
  }

  const { data, error } = await supabaseAdmin
    .from("control_sessions")
    .select(LIST_COLUMNS)
    .eq("user_id", userId)
    .eq("archived", false)
    .order("pinned", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data || []);
}

export async function POST(req: Request) {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  const body = (await req.json().catch(() => ({}))) as {
    title?: string;
    project?: string | null;
    repo_id?: unknown;
  };
  const parsedRepoId = parseControlSessionRepoId(body.repo_id);
  if (!parsedRepoId.ok) {
    return NextResponse.json({ error: "Invalid repo_id" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("control_sessions")
    .insert({
      user_id: userId,
      title: body.title?.trim() || "New session",
      project: body.project?.trim().slice(0, 160) || null,
      repo_id: parsedRepoId.value,
    })
    .select("*")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message || "Failed to create session" },
      { status: 500 }
    );
  }

  return NextResponse.json(data);
}

export async function PUT(req: Request) {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  const body = (await req.json()) as {
    id?: string;
    expected_updated_at?: string | null;
    title?: string;
    project?: string | null;
    repo_id?: unknown;
    messages?: unknown;
    pinned?: boolean;
    archived?: boolean;
  };
  if (Object.hasOwn(body, "repo_id")) {
    const parsedRepoId = parseControlSessionRepoId(body.repo_id);
    if (!parsedRepoId.ok) {
      return NextResponse.json({ error: "Invalid repo_id" }, { status: 400 });
    }
    body.repo_id = parsedRepoId.value;
  }
  const { id, expected_updated_at: expectedUpdatedAt } = body;

  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }
  if (!expectedUpdatedAt) {
    return NextResponse.json(
      { error: "Missing expected_updated_at" },
      { status: 400 }
    );
  }

  const fields = pickControlSessionUpdateFields(body);

  const { data, error } = await supabaseAdmin
    .from("control_sessions")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId)
    .eq("updated_at", expectedUpdatedAt)
    .select("*")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    const current = await getSessionRecord(id, userId);
    return NextResponse.json(
      { error: "CONFLICT", session: current },
      { status: 409 }
    );
  }

  return NextResponse.json({ ok: true, session: data });
}

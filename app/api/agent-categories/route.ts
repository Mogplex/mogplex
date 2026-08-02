import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUserId } from "@/lib/auth";
import { AGENT_CATEGORIES } from "@/lib/agents/templates";
import {
  MAX_AGENT_CATEGORY_LABEL_LENGTH,
  dedupeCategorySlug,
  normalizeCategoryLabel,
  slugifyCategoryLabel,
} from "@/lib/agents/category-utils";

const BUILT_IN_SLUGS = new Set(Object.keys(AGENT_CATEGORIES));
const MAX_CATEGORIES_PER_USER = 50;
const SLUG_DEDUPE_LIMIT = 20;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET() {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  const { data, error } = await supabaseAdmin
    .from("agent_categories")
    .select("id, slug, label, created_at")
    .eq("user_id", userId)
    .order("label", { ascending: true });

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: Request) {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  const body = await req.json().catch(() => null);
  const rawLabel = body && typeof body === "object" ? body.label : null;
  const label = normalizeCategoryLabel(rawLabel);
  if (!label) {
    return NextResponse.json(
      { error: "Category name is required" },
      { status: 400 }
    );
  }
  if (label.length > MAX_AGENT_CATEGORY_LABEL_LENGTH) {
    return NextResponse.json(
      {
        error: `Category name must be ${MAX_AGENT_CATEGORY_LABEL_LENGTH} characters or less`,
      },
      { status: 400 }
    );
  }

  const baseSlug = slugifyCategoryLabel(label);
  if (!baseSlug) {
    return NextResponse.json(
      { error: "Category name must include letters or numbers" },
      { status: 400 }
    );
  }

  const { data: existing, error: existingError } = await supabaseAdmin
    .from("agent_categories")
    .select("slug")
    .eq("user_id", userId);
  if (existingError)
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  if ((existing?.length ?? 0) >= MAX_CATEGORIES_PER_USER) {
    return NextResponse.json(
      { error: `You can have at most ${MAX_CATEGORIES_PER_USER} categories` },
      { status: 400 }
    );
  }
  const taken = new Set<string>([
    ...BUILT_IN_SLUGS,
    ...(existing ?? []).map((row: { slug: string }) => row.slug),
  ]);

  const slug = dedupeCategorySlug(baseSlug, taken, SLUG_DEDUPE_LIMIT);
  if (!slug) {
    return NextResponse.json(
      { error: "Could not generate a unique category slug" },
      { status: 409 }
    );
  }

  const { data, error } = await supabaseAdmin
    .from("agent_categories")
    .insert({ user_id: userId, slug, label })
    .select("id, slug, label, created_at")
    .single();

  if (error) {
    if (error.message === "Category limit reached") {
      return NextResponse.json(
        { error: `You can have at most ${MAX_CATEGORIES_PER_USER} categories` },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}

export async function DELETE(req: Request) {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin.rpc(
    "delete_agent_category_cascade",
    { p_user_id: userId, p_category_id: id }
  );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.deleted) {
    return NextResponse.json({ error: "Category not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, cleared: row.cleared_agents ?? 0 });
}

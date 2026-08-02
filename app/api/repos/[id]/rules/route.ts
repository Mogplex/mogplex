import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOwnedRepo } from "@/lib/repos";
import type { NextRequest } from "next/server";

type RouteContext = { params: Promise<{ id: string }> };

/** Resolved rules for a repo: global rules minus excluded + repo-specific */
export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { id: repoId } = await ctx.params;
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;
  const repo = await getOwnedRepo(repoId, userId);
  if (!repo)
    return NextResponse.json({ error: "Repo not found" }, { status: 404 });

  // SELECT only what the panel renders. Content is pre-truncated to the same
  // 80-char preview the UI shows so we don't ship full rule bodies — for
  // active OR excluded items.
  const PREVIEW_LEN = 80;
  const [{ data: globalRules }, { data: overrides }] = await Promise.all([
    supabaseAdmin
      .from("agent_rules")
      .select("id, name, content")
      .eq("user_id", userId),
    supabaseAdmin
      .from("repo_rule_overrides")
      .select("id, rule_id, excluded, name, content")
      .eq("repo_id", repoId),
  ]);

  const excludedSet = new Set(
    (overrides ?? [])
      .filter((o) => o.excluded && o.rule_id)
      .map((o) => o.rule_id!)
  );

  const resolved = (globalRules ?? [])
    .filter((r) => !excludedSet.has(r.id))
    .map((r) => ({
      id: r.id,
      name: r.name,
      content_preview: (r.content ?? "").slice(0, PREVIEW_LEN),
      source: "global" as const,
    }));

  const excludedInherited = (globalRules ?? [])
    .filter((r) => excludedSet.has(r.id))
    .map((r) => ({
      id: r.id,
      name: r.name,
      content_preview: (r.content ?? "").slice(0, PREVIEW_LEN),
    }));

  // For repo-only entries the resolved `id` IS the override row id; the
  // panel uses it both as a React key and as the `overrideId` for DELETE.
  const repoSpecific = (overrides ?? [])
    .filter((o) => !o.rule_id && o.name)
    .map((o) => ({
      id: o.id,
      name: o.name!,
      content_preview: (o.content ?? "").slice(0, PREVIEW_LEN),
      source: "repo" as const,
    }));

  return NextResponse.json({
    rules: [...resolved, ...repoSpecific],
    excluded_inherited: excludedInherited,
  });
}

/** Add repo-specific rule or exclude a global rule */
export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id: repoId } = await ctx.params;
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;
  const repo = await getOwnedRepo(repoId, userId);
  if (!repo)
    return NextResponse.json({ error: "Repo not found" }, { status: 404 });

  const body = await req.json();

  if (body.rule_id && typeof body.excluded === "boolean") {
    // Exclude/include a global rule
    const { error } = await supabaseAdmin
      .from("repo_rule_overrides")
      .upsert(
        { repo_id: repoId, rule_id: body.rule_id, excluded: body.excluded },
        { onConflict: "repo_id,rule_id" }
      );
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
  } else if (body.name) {
    // Add repo-specific rule
    const { error } = await supabaseAdmin.from("repo_rule_overrides").insert({
      repo_id: repoId,
      name: body.name,
      content: body.content ?? "",
    });
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    return NextResponse.json(
      { error: "rule_id+excluded or name required" },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const { id: repoId } = await ctx.params;
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;
  const repo = await getOwnedRepo(repoId, userId);
  if (!repo)
    return NextResponse.json({ error: "Repo not found" }, { status: 404 });

  const { searchParams } = new URL(req.url);
  const overrideId = searchParams.get("overrideId");
  if (!overrideId)
    return NextResponse.json({ error: "overrideId required" }, { status: 400 });

  const { error } = await supabaseAdmin
    .from("repo_rule_overrides")
    .delete()
    .eq("id", overrideId)
    .eq("repo_id", repoId);

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

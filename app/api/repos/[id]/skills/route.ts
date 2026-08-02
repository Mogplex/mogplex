import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOwnedRepo } from "@/lib/repos";
import type { NextRequest } from "next/server";

type RouteContext = { params: Promise<{ id: string }> };

/** Resolved skills for a repo: global skills minus excluded + repo-specific */
export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { id: repoId } = await ctx.params;
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;
  const repo = await getOwnedRepo(repoId, userId);
  if (!repo)
    return NextResponse.json({ error: "Repo not found" }, { status: 404 });

  // SELECT only what the panel renders for inherited skills (name + description).
  // Override rows still need skill_id/excluded for the include/exclude logic and
  // name/description to render repo-only skills.
  const [{ data: globalSkills }, { data: overrides }] = await Promise.all([
    supabaseAdmin
      .from("skills")
      .select("id, name, description")
      .eq("user_id", userId),
    supabaseAdmin
      .from("repo_skill_overrides")
      .select("id, skill_id, excluded, name, description")
      .eq("repo_id", repoId),
  ]);

  const excludedSet = new Set(
    (overrides ?? [])
      .filter((o) => o.excluded && o.skill_id)
      .map((o) => o.skill_id!)
  );

  const resolved = (globalSkills ?? [])
    .filter((s) => !excludedSet.has(s.id))
    .map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      source: "global" as const,
    }));

  const excludedInherited = (globalSkills ?? [])
    .filter((s) => excludedSet.has(s.id))
    .map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
    }));

  // For repo-only entries the resolved `id` IS the override row id; the
  // panel uses it both as a React key and as the `overrideId` for DELETE.
  const repoSpecific = (overrides ?? [])
    .filter((o) => !o.skill_id && o.name)
    .map((o) => ({
      id: o.id,
      name: o.name!,
      description: o.description,
      source: "repo" as const,
    }));

  return NextResponse.json({
    skills: [...resolved, ...repoSpecific],
    excluded_inherited: excludedInherited,
  });
}

/** Add repo-specific skill or exclude a global skill */
export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id: repoId } = await ctx.params;
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;
  const repo = await getOwnedRepo(repoId, userId);
  if (!repo)
    return NextResponse.json({ error: "Repo not found" }, { status: 404 });

  const body = await req.json();

  if (body.skill_id && typeof body.excluded === "boolean") {
    const { error } = await supabaseAdmin
      .from("repo_skill_overrides")
      .upsert(
        { repo_id: repoId, skill_id: body.skill_id, excluded: body.excluded },
        { onConflict: "repo_id,skill_id" }
      );
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
  } else if (body.name) {
    const { error } = await supabaseAdmin.from("repo_skill_overrides").insert({
      repo_id: repoId,
      name: body.name,
      description: body.description,
      content: body.content ?? "",
    });
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    return NextResponse.json(
      { error: "skill_id+excluded or name required" },
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
    .from("repo_skill_overrides")
    .delete()
    .eq("id", overrideId)
    .eq("repo_id", repoId);

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

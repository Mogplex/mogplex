import { NextResponse } from "next/server";
import { requireProfileId } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isReservedSlug } from "@/lib/reserved-slugs";
import { isValidScopeSlug } from "@/lib/team-slug";
import { recordTeamAuditEvent } from "@/lib/team-audit";

export type CreateTeamResponse = {
  team: { id: string; slug: string; name: string };
};

export async function POST(request: Request) {
  const profileId = await requireProfileId();
  if (profileId instanceof Response) return profileId;

  let body: { name?: unknown; slug?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const slug =
    typeof body.slug === "string" ? body.slug.trim().toLowerCase() : "";

  if (name.length === 0 || name.length > 80) {
    return NextResponse.json(
      { error: "Team name must be 1-80 characters" },
      { status: 422 }
    );
  }
  if (!isValidScopeSlug(slug)) {
    return NextResponse.json(
      {
        error:
          "Invalid slug: must be 1-39 chars [a-z0-9-], no leading/trailing/double hyphens",
      },
      { status: 422 }
    );
  }
  if (isReservedSlug(slug)) {
    return NextResponse.json({ error: "Slug is reserved" }, { status: 422 });
  }

  const { data, error } = await supabaseAdmin
    .from("teams")
    .insert({ name, slug, owner_user_id: profileId })
    .select("id, slug, name")
    .single();

  if (error) {
    // DB-side slug-guard or unique index raises here. Map known cases.
    const message = error.message || "";
    if (
      error.code === "23505" ||
      message.includes("unique_violation") ||
      message.includes("already taken")
    ) {
      return NextResponse.json(
        { error: "Slug already taken" },
        { status: 409 }
      );
    }
    if (message.includes("reserved")) {
      return NextResponse.json({ error: "Slug is reserved" }, { status: 422 });
    }
    return NextResponse.json(
      { error: message || "Failed to create team" },
      { status: 500 }
    );
  }

  const team = data as { id: string; slug: string; name: string };
  await recordTeamAuditEvent({
    productTeamId: team.id,
    actorUserId: profileId,
    action: "team.created",
    targetType: "team",
    targetId: team.id,
    payload: { name: team.name, slug: team.slug },
  });

  return NextResponse.json({ team }, { status: 201 });
}

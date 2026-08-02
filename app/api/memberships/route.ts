import { NextResponse } from "next/server";
import { requireProfileId } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { teamIconUrlFromPath } from "@/lib/team-icons";

export type MembershipsResponse = {
  personal: {
    slug: string | null;
    name: string | null;
    avatarUrl: string | null;
  };
  teams: Array<{
    id: string;
    slug: string;
    name: string;
    iconUrl: string | null;
    role: "owner" | "admin" | "developer" | "viewer";
  }>;
};

export async function GET() {
  const profileId = await requireProfileId();
  if (profileId instanceof Response) return profileId;

  const [profileResult, membersResult] = await Promise.all([
    supabaseAdmin
      .from("profiles")
      .select("slug, name, avatar_url")
      .eq("id", profileId)
      .single(),
    supabaseAdmin
      .from("team_members")
      .select("role, team:teams(id, slug, name, icon_path)")
      .eq("user_id", profileId),
  ]);

  if (profileResult.error) {
    return NextResponse.json(
      { error: "Failed to load profile" },
      { status: 500 }
    );
  }

  if (membersResult.error) {
    return NextResponse.json(
      { error: "Failed to load team memberships" },
      { status: 500 }
    );
  }

  const profile = profileResult.data;
  // PostgREST returns the FK join either as object (one) or array (many)
  // depending on inferred cardinality; normalize to the object form.
  type TeamJoinRow = {
    id: string;
    slug: string;
    name: string;
    icon_path: string | null;
  };
  const memberships = (membersResult.data ?? []) as unknown as Array<{
    role: "owner" | "admin" | "developer" | "viewer";
    team: TeamJoinRow | Array<TeamJoinRow> | null;
  }>;

  const teams = memberships
    .map((row) => {
      const team = Array.isArray(row.team) ? row.team[0] : row.team;
      if (!team) return null;
      return {
        id: team.id,
        slug: team.slug,
        name: team.name,
        iconUrl: teamIconUrlFromPath(team.icon_path),
        role: row.role,
      };
    })
    .filter(
      (
        row
      ): row is {
        id: string;
        slug: string;
        name: string;
        iconUrl: string | null;
        role: "owner" | "admin" | "developer" | "viewer";
      } => row !== null
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  const body: MembershipsResponse = {
    personal: {
      slug: (profile?.slug as string | null) ?? null,
      name: (profile?.name as string | null) ?? null,
      avatarUrl: (profile?.avatar_url as string | null) ?? null,
    },
    teams,
  };

  return NextResponse.json(body);
}

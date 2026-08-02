import { NextResponse } from "next/server";
import { requireProfileId } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { loadTeamMembershipAuth } from "@/lib/team-management";
import { teamIconUrlFromPath } from "@/lib/team-icons";
import type { TeamRole } from "@/lib/team-capabilities";

type ProfileJoin =
  | {
      id: string;
      name: string | null;
      username: string | null;
      github_username: string | null;
      email: string | null;
      avatar_url: string | null;
    }
  | Array<{
      id: string;
      name: string | null;
      username: string | null;
      github_username: string | null;
      email: string | null;
      avatar_url: string | null;
    }>
  | null;

export type TeamMembersResponse = {
  team: { id: string; name: string; slug: string; iconUrl: string | null };
  viewer: { role: TeamRole; canManage: boolean };
  members: Array<{
    userId: string;
    name: string | null;
    username: string | null;
    email: string | null;
    avatarUrl: string | null;
    role: TeamRole;
    joinedAt: string;
    isCurrentUser: boolean;
  }>;
  invites: Array<{
    id: string;
    email: string;
    role: "admin" | "developer" | "viewer";
    expiresAt: string;
    createdAt: string;
  }>;
};

function profileFromJoin(profile: ProfileJoin) {
  return Array.isArray(profile) ? profile[0] : profile;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ teamId: string }> }
) {
  const profileId = await requireProfileId();
  if (profileId instanceof Response) return profileId;

  const { teamId } = await context.params;
  const auth = await loadTeamMembershipAuth(teamId, profileId);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const [teamResult, membersResult, invitesResult] = await Promise.all([
    supabaseAdmin
      .from("teams")
      .select("id, name, slug, icon_path")
      .eq("id", teamId)
      .single(),
    supabaseAdmin
      .from("team_members")
      .select(
        "user_id, role, joined_at, profile:profiles(id, name, username, github_username, email, avatar_url)"
      )
      .eq("team_id", teamId)
      .order("joined_at"),
    supabaseAdmin
      .from("team_invites")
      .select("id, email, role, expires_at, created_at")
      .eq("team_id", teamId)
      .is("accepted_at", null)
      .order("created_at", { ascending: false }),
  ]);

  if (teamResult.error || !teamResult.data) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }
  if (membersResult.error) {
    return NextResponse.json(
      { error: membersResult.error.message },
      { status: 500 }
    );
  }
  if (invitesResult.error) {
    return NextResponse.json(
      { error: invitesResult.error.message },
      { status: 500 }
    );
  }

  const members = (
    (membersResult.data ?? []) as Array<{
      user_id: string;
      role: TeamRole;
      joined_at: string;
      profile: ProfileJoin;
    }>
  ).map((row) => {
    const profile = profileFromJoin(row.profile);
    return {
      userId: row.user_id,
      name: profile?.name ?? null,
      username: profile?.username ?? profile?.github_username ?? null,
      email: profile?.email ?? null,
      avatarUrl: profile?.avatar_url ?? null,
      role: row.role,
      joinedAt: row.joined_at,
      isCurrentUser: row.user_id === profileId,
    };
  });

  const invites = (
    (invitesResult.data ?? []) as Array<{
      id: string;
      email: string;
      role: "admin" | "developer" | "viewer";
      expires_at: string;
      created_at: string;
    }>
  ).map((row) => ({
    id: row.id,
    email: row.email,
    role: row.role,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  }));

  const teamRow = teamResult.data as {
    id: string;
    name: string;
    slug: string;
    icon_path: string | null;
  };

  return NextResponse.json({
    team: {
      id: teamRow.id,
      name: teamRow.name,
      slug: teamRow.slug,
      iconUrl: teamIconUrlFromPath(teamRow.icon_path),
    },
    viewer: { role: auth.role, canManage: auth.canManage },
    members,
    invites,
  });
}

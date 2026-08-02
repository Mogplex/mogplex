import { NextResponse } from "next/server";
import { requireProfileId } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { recordTeamAuditEvent } from "@/lib/team-audit";

export type InviteLookupResponse = {
  invite: {
    teamName: string;
    teamSlug: string;
    inviterName: string | null;
    role: "admin" | "developer" | "viewer";
    expiresAt: string;
    expired: boolean;
    alreadyAccepted: boolean;
  };
  emailMatch: boolean;
  inviteEmail: string;
  currentEmail: string | null;
};

async function lookupInvite(token: string) {
  // Service-role: the recipient is authed but not yet a team member, so RLS
  // (team_invites_admin policy) would block reading the invite row otherwise.
  const { data } = await supabaseAdmin
    .from("team_invites")
    .select(
      "id, team_id, email, role, expires_at, accepted_at, invited_by_user_id"
    )
    .eq("token", token)
    .maybeSingle();
  return data;
}

async function getInviterName(profileId: string | null) {
  if (!profileId) return null;
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("name, username")
    .eq("id", profileId)
    .maybeSingle();
  return (
    (data?.name as string | null) || (data?.username as string | null) || null
  );
}

async function getProfileEmail(profileId: string) {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("email")
    .eq("id", profileId)
    .maybeSingle();
  return (data?.email as string | null) || null;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> }
) {
  const profileId = await requireProfileId();
  if (profileId instanceof Response) return profileId;

  const { token } = await context.params;
  const invite = await lookupInvite(token);
  if (!invite) {
    return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  }

  const { data: team } = await supabaseAdmin
    .from("teams")
    .select("name, slug")
    .eq("id", invite.team_id)
    .single();

  if (!team) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  const [inviterName, currentEmail] = await Promise.all([
    getInviterName((invite.invited_by_user_id as string | null) ?? null),
    getProfileEmail(profileId),
  ]);

  const expired = new Date(invite.expires_at as string).getTime() < Date.now();
  const alreadyAccepted = Boolean(invite.accepted_at);
  const inviteEmail = (invite.email as string).toLowerCase();
  const userEmail = currentEmail?.toLowerCase() ?? null;
  const emailMatch = userEmail !== null && userEmail === inviteEmail;

  const body: InviteLookupResponse = {
    invite: {
      teamName: team.name as string,
      teamSlug: team.slug as string,
      inviterName,
      role: invite.role as "admin" | "developer" | "viewer",
      expiresAt: invite.expires_at as string,
      expired,
      alreadyAccepted,
    },
    emailMatch,
    inviteEmail,
    currentEmail,
  };

  return NextResponse.json(body);
}

export type AcceptInviteResponse = {
  team: { id: string; slug: string };
};

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> }
) {
  const profileId = await requireProfileId();
  if (profileId instanceof Response) return profileId;

  const { token } = await context.params;

  let body: { confirmMismatch?: unknown };
  try {
    body = (await request.json().catch(() => ({}))) as typeof body;
  } catch {
    body = {};
  }
  const confirmMismatch = body.confirmMismatch === true;

  const invite = await lookupInvite(token);
  if (!invite) {
    return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  }
  if (invite.accepted_at) {
    return NextResponse.json({ error: "already_accepted" }, { status: 410 });
  }
  if (new Date(invite.expires_at as string).getTime() < Date.now()) {
    return NextResponse.json({ error: "expired" }, { status: 410 });
  }

  const currentEmail = await getProfileEmail(profileId);
  const inviteEmail = (invite.email as string).toLowerCase();
  const emailMatch =
    currentEmail !== null && currentEmail.toLowerCase() === inviteEmail;
  if (!emailMatch && !confirmMismatch) {
    return NextResponse.json(
      { error: "mismatch_unconfirmed" },
      { status: 409 }
    );
  }

  // Insert membership + mark invite accepted. Service-role bypasses the
  // is_team_admin() check on team_members_write — the user is the new member,
  // not an admin yet.
  const { error: memberError } = await supabaseAdmin
    .from("team_members")
    .insert({
      team_id: invite.team_id,
      user_id: profileId,
      role: invite.role,
      invited_by_user_id: invite.invited_by_user_id,
    });

  if (memberError && memberError.code !== "23505") {
    return NextResponse.json(
      { error: memberError.message || "Failed to join team" },
      { status: 500 }
    );
  }

  await supabaseAdmin
    .from("team_invites")
    .update({ accepted_at: new Date().toISOString() })
    .eq("id", invite.id);

  const { data: team } = await supabaseAdmin
    .from("teams")
    .select("id, slug")
    .eq("id", invite.team_id)
    .single();

  if (!team) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  await recordTeamAuditEvent({
    productTeamId: invite.team_id as string,
    actorUserId: profileId,
    action: "invite.accepted",
    targetType: "invite",
    targetId: invite.id as string,
    payload: {
      email: invite.email as string,
      role: invite.role as string,
      email_match: emailMatch,
    },
  });

  return NextResponse.json({
    team: { id: team.id as string, slug: team.slug as string },
  });
}

import { NextResponse } from "next/server";
import { requireProfileId } from "@/lib/auth";
import { sendTeamInvite } from "@/lib/email/send-team-invite";
import { generateInviteToken } from "@/lib/invite-token";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { canInviteRole, loadTeamMembershipAuth } from "@/lib/team-management";
import { recordTeamAuditEvent } from "@/lib/team-audit";
import type { InviteRole } from "@/app/api/teams/[teamId]/invites/route";

async function loadInvite(teamId: string, inviteId: string) {
  const { data, error } = await supabaseAdmin
    .from("team_invites")
    .select("id, team_id, email, role, accepted_at")
    .eq("team_id", teamId)
    .eq("id", inviteId)
    .maybeSingle();

  if (error || !data) return null;
  return data as {
    id: string;
    team_id: string;
    email: string;
    role: InviteRole;
    accepted_at: string | null;
  };
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ teamId: string; inviteId: string }> }
) {
  const profileId = await requireProfileId();
  if (profileId instanceof Response) return profileId;

  const { teamId, inviteId } = await context.params;
  const auth = await loadTeamMembershipAuth(teamId, profileId);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const invite = await loadInvite(teamId, inviteId);
  if (!invite || invite.accepted_at) {
    return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  }
  if (!canInviteRole(auth.role, invite.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { error } = await supabaseAdmin
    .from("team_invites")
    .delete()
    .eq("team_id", teamId)
    .eq("id", inviteId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await recordTeamAuditEvent({
    productTeamId: teamId,
    actorUserId: profileId,
    action: "invite.revoked",
    targetType: "invite",
    targetId: inviteId,
    payload: { email: invite.email, role: invite.role },
  });

  return NextResponse.json({ ok: true });
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ teamId: string; inviteId: string }> }
) {
  const profileId = await requireProfileId();
  if (profileId instanceof Response) return profileId;

  const { teamId, inviteId } = await context.params;
  const auth = await loadTeamMembershipAuth(teamId, profileId);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const invite = await loadInvite(teamId, inviteId);
  if (!invite || invite.accepted_at) {
    return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  }
  if (!canInviteRole(auth.role, invite.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [teamResult, inviterResult] = await Promise.all([
    supabaseAdmin.from("teams").select("name").eq("id", teamId).single(),
    supabaseAdmin
      .from("profiles")
      .select("name, username")
      .eq("id", profileId)
      .single(),
  ]);

  if (teamResult.error || !teamResult.data) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  const token = generateInviteToken();
  const expiresAt = new Date(
    Date.now() + 7 * 24 * 60 * 60 * 1000
  ).toISOString();
  const { data: updated, error } = await supabaseAdmin
    .from("team_invites")
    .update({
      token,
      expires_at: expiresAt,
      invited_by_user_id: profileId,
    })
    .eq("team_id", teamId)
    .eq("id", inviteId)
    .select("id, email, role, expires_at")
    .single();

  if (error || !updated) {
    return NextResponse.json(
      { error: error?.message || "Failed to resend invite" },
      { status: 500 }
    );
  }

  const inviterName =
    (inviterResult.data?.name as string | null) ||
    (inviterResult.data?.username as string | null) ||
    null;

  const sendResult = await sendTeamInvite({
    email: invite.email,
    teamName: teamResult.data.name as string,
    inviterName,
    role: invite.role,
    token,
  });

  await recordTeamAuditEvent({
    productTeamId: teamId,
    actorUserId: profileId,
    action: "invite.resent",
    targetType: "invite",
    targetId: inviteId,
    payload: {
      email: invite.email,
      role: invite.role,
      delivery: sendResult.ok ? sendResult.channel : "resend_error",
      expires_at: updated.expires_at as string,
    },
  });

  return NextResponse.json({
    invite: {
      id: updated.id as string,
      email: updated.email as string,
      role: updated.role as InviteRole,
      expiresAt: updated.expires_at as string,
    },
    delivery: sendResult.ok ? sendResult.channel : "resend_error",
  });
}

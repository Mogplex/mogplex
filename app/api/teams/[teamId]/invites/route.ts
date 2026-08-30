import { NextResponse } from "next/server";
import { requireProfileId } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { generateInviteToken } from "@/lib/invite-token";
import { sendTeamInvite } from "@/lib/email/send-team-invite";
import { canInviteRole, loadTeamMembershipAuth } from "@/lib/team-management";
import { recordTeamAuditEvent } from "@/lib/team-audit";

export type InviteRole = "admin" | "developer" | "viewer";
export type InviteDelivery = "resend" | "log" | "resend_error";

const INVITE_ROLES = new Set<InviteRole>(["admin", "developer", "viewer"]);

export type CreateInviteResponse = {
  invite: {
    id: string;
    email: string;
    role: InviteRole;
    expiresAt: string;
  };
  delivery: InviteDelivery;
};

export async function POST(
  request: Request,
  context: { params: Promise<{ teamId: string }> }
) {
  const profileId = await requireProfileId();
  if (profileId instanceof Response) return profileId;

  const { teamId } = await context.params;

  let parsedBody: unknown;
  try {
    parsedBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (
    !parsedBody ||
    typeof parsedBody !== "object" ||
    Array.isArray(parsedBody)
  ) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const body = parsedBody as Record<string, unknown>;

  const emailRaw = typeof body.email === "string" ? body.email.trim() : "";
  const email = emailRaw.toLowerCase();
  const role = typeof body.role === "string" ? body.role : "";

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json(
      { error: "Valid email required" },
      { status: 422 }
    );
  }
  if (!INVITE_ROLES.has(role as never)) {
    return NextResponse.json(
      { error: "Role must be admin, developer, or viewer" },
      { status: 422 }
    );
  }

  const auth = await loadTeamMembershipAuth(teamId, profileId);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (!canInviteRole(auth.role, role as InviteRole)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Skip when this email is already a team member (joined via prior invite or
  // direct add). The DB doesn't enforce email→member uniqueness because we key
  // on user_id; check explicitly so the inviter sees a clear error.
  const { data: existing, error: profileLookupError } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (profileLookupError) {
    return NextResponse.json(
      { error: "Failed to check existing team membership" },
      { status: 500 }
    );
  }
  if (existing) {
    const { data: alreadyMember, error: memberLookupError } =
      await supabaseAdmin
        .from("team_members")
        .select("team_id")
        .eq("team_id", teamId)
        .eq("user_id", existing.id)
        .maybeSingle();
    if (memberLookupError) {
      return NextResponse.json(
        { error: "Failed to check existing team membership" },
        { status: 500 }
      );
    }
    if (alreadyMember) {
      return NextResponse.json(
        { error: "That user is already a team member" },
        { status: 409 }
      );
    }
  }

  const [teamResult, inviterResult] = await Promise.all([
    supabaseAdmin
      .from("teams")
      .select("id, name, slug")
      .eq("id", teamId)
      .maybeSingle(),
    supabaseAdmin
      .from("profiles")
      .select("name, username")
      .eq("id", profileId)
      .maybeSingle(),
  ]);

  if (teamResult.error) {
    return NextResponse.json({ error: "Failed to load team" }, { status: 500 });
  }
  if (!teamResult.data) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }
  if (inviterResult.error) {
    return NextResponse.json(
      { error: "Failed to load inviter" },
      { status: 500 }
    );
  }

  const token = generateInviteToken();
  const { data: invite, error } = await supabaseAdmin
    .from("team_invites")
    .insert({
      team_id: teamId,
      email,
      role: role as InviteRole,
      token,
      invited_by_user_id: profileId,
    })
    .select("id, email, role, expires_at")
    .single();

  if (error || !invite) {
    return NextResponse.json(
      { error: error?.message || "Failed to create invite" },
      { status: 500 }
    );
  }

  const inviterName =
    (inviterResult.data?.name as string | null) ||
    (inviterResult.data?.username as string | null) ||
    null;

  const sendResult = await sendTeamInvite({
    email,
    teamName: teamResult.data.name as string,
    inviterName,
    role: role as InviteRole,
    token,
  }).catch(() => ({ ok: false as const, reason: "resend_error" as const }));

  const delivery: CreateInviteResponse["delivery"] = sendResult.ok
    ? sendResult.channel
    : "resend_error";

  await recordTeamAuditEvent({
    productTeamId: teamId,
    actorUserId: profileId,
    action: "invite.created",
    targetType: "invite",
    targetId: invite.id as string,
    payload: {
      email,
      role,
      delivery,
      expires_at: invite.expires_at as string,
    },
  });

  return NextResponse.json(
    {
      invite: {
        id: invite.id as string,
        email: invite.email as string,
        role: invite.role as InviteRole,
        expiresAt: invite.expires_at as string,
      },
      delivery,
    },
    { status: 201 }
  );
}

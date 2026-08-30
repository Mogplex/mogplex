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

type InviteLookupRow = {
  id: string;
  team_id: string;
  email: string;
  role: "admin" | "developer" | "viewer";
  expires_at: string;
  accepted_at: string | null;
  invited_by_user_id: string | null;
};

type InviteGetDeps = {
  requireProfileId: typeof requireProfileId;
  lookupInvite: (token: string) => Promise<InviteLookupRow | null>;
  loadTeam: (teamId: string) => Promise<{ name: string; slug: string } | null>;
  getInviterName: (profileId: string | null) => Promise<string | null>;
  getProfileEmail: (profileId: string) => Promise<string | null>;
};

async function lookupInvite(token: string): Promise<InviteLookupRow | null> {
  // Service-role: the recipient is authed but not yet a team member, so RLS
  // (team_invites_admin policy) would block reading the invite row otherwise.
  const { data, error } = await supabaseAdmin
    .from("team_invites")
    .select(
      "id, team_id, email, role, expires_at, accepted_at, invited_by_user_id"
    )
    .eq("token", token)
    .maybeSingle();
  if (error) throw new Error("Failed to load invite", { cause: error });
  return data as InviteLookupRow | null;
}

async function loadTeam(teamId: string) {
  const { data, error } = await supabaseAdmin
    .from("teams")
    .select("name, slug")
    .eq("id", teamId)
    .maybeSingle();
  if (error) throw new Error("Failed to load team", { cause: error });
  return data as { name: string; slug: string } | null;
}

async function getInviterName(profileId: string | null) {
  if (!profileId) return null;
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("name, username")
    .eq("id", profileId)
    .maybeSingle();
  if (error) throw new Error("Failed to load inviter", { cause: error });
  return (
    (data?.name as string | null) || (data?.username as string | null) || null
  );
}

async function getProfileEmail(profileId: string) {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("email")
    .eq("id", profileId)
    .maybeSingle();
  if (error) throw new Error("Failed to load profile", { cause: error });
  return (data?.email as string | null) || null;
}

const defaultInviteGetDeps: InviteGetDeps = {
  requireProfileId,
  lookupInvite,
  loadTeam,
  getInviterName,
  getProfileEmail,
};

export function createInviteGetHandler(overrides: Partial<InviteGetDeps> = {}) {
  const deps: InviteGetDeps = { ...defaultInviteGetDeps, ...overrides };

  return async function GET(
    _request: Request,
    context: { params: Promise<{ token: string }> }
  ) {
    const profileId = await deps.requireProfileId();
    if (profileId instanceof Response) return profileId;

    try {
      const { token } = await context.params;
      const invite = await deps.lookupInvite(token);
      if (!invite) {
        return NextResponse.json(
          { error: "Invite not found" },
          { status: 404 }
        );
      }

      const team = await deps.loadTeam(invite.team_id);
      if (!team) {
        return NextResponse.json({ error: "Team not found" }, { status: 404 });
      }

      const [inviterName, currentEmail] = await Promise.all([
        deps.getInviterName(invite.invited_by_user_id),
        deps.getProfileEmail(profileId),
      ]);

      const expired = new Date(invite.expires_at).getTime() < Date.now();
      const alreadyAccepted = Boolean(invite.accepted_at);
      const inviteEmail = invite.email.toLowerCase();
      const userEmail = currentEmail?.toLowerCase() ?? null;
      const emailMatch = userEmail !== null && userEmail === inviteEmail;

      const body: InviteLookupResponse = {
        invite: {
          teamName: team.name,
          teamSlug: team.slug,
          inviterName,
          role: invite.role,
          expiresAt: invite.expires_at,
          expired,
          alreadyAccepted,
        },
        emailMatch,
        inviteEmail,
        currentEmail,
      };

      return NextResponse.json(body);
    } catch {
      return NextResponse.json(
        { error: "Failed to load invite" },
        { status: 500 }
      );
    }
  };
}

export const GET = createInviteGetHandler();

export type AcceptInviteResponse = {
  team: { id: string; slug: string };
};

type AtomicInviteAcceptance = {
  invite_id: string;
  team_id: string;
  team_slug: string;
  invite_email: string;
  invite_role: "admin" | "developer" | "viewer";
  email_match: boolean;
};

type AcceptInviteDeps = {
  requireProfileId: typeof requireProfileId;
  acceptInvite: (input: {
    token: string;
    profileId: string;
    confirmMismatch: boolean;
  }) => Promise<{
    data: AtomicInviteAcceptance | null;
    error: { message: string } | null;
  }>;
  recordTeamAuditEvent: typeof recordTeamAuditEvent;
};

const defaultAcceptInviteDeps: AcceptInviteDeps = {
  requireProfileId,
  async acceptInvite(input) {
    const { data, error } = await supabaseAdmin
      .rpc("accept_team_invite", {
        p_token: input.token,
        p_profile_id: input.profileId,
        p_confirm_mismatch: input.confirmMismatch,
      })
      .maybeSingle();
    return {
      data: data as AtomicInviteAcceptance | null,
      error: error ? { message: error.message } : null,
    };
  },
  recordTeamAuditEvent,
};

function inviteAcceptanceErrorResponse(message: string) {
  if (message.includes("invite_not_found")) {
    return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  }
  if (message.includes("already_accepted")) {
    return NextResponse.json({ error: "already_accepted" }, { status: 410 });
  }
  if (message.includes("expired")) {
    return NextResponse.json({ error: "expired" }, { status: 410 });
  }
  if (message.includes("mismatch_unconfirmed")) {
    return NextResponse.json(
      { error: "mismatch_unconfirmed" },
      { status: 409 }
    );
  }
  if (message.includes("profile_not_found")) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }
  if (message.includes("team_not_found")) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }
  return NextResponse.json(
    { error: "Failed to accept invite" },
    { status: 500 }
  );
}

export function createAcceptInviteHandler(
  overrides: Partial<AcceptInviteDeps> = {}
) {
  const deps: AcceptInviteDeps = {
    ...defaultAcceptInviteDeps,
    ...overrides,
  };

  return async function POST(
    request: Request,
    context: { params: Promise<{ token: string }> }
  ) {
    const profileId = await deps.requireProfileId();
    if (profileId instanceof Response) return profileId;

    const { token } = await context.params;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const { data, error } = await deps.acceptInvite({
      token,
      profileId,
      confirmMismatch:
        (body as Record<string, unknown>).confirmMismatch === true,
    });
    if (error) return inviteAcceptanceErrorResponse(error.message);
    if (!data) {
      return NextResponse.json(
        { error: "Failed to accept invite" },
        { status: 500 }
      );
    }

    await deps.recordTeamAuditEvent({
      productTeamId: data.team_id,
      actorUserId: profileId,
      action: "invite.accepted",
      targetType: "invite",
      targetId: data.invite_id,
      payload: {
        email: data.invite_email,
        role: data.invite_role,
        email_match: data.email_match,
      },
    });

    return NextResponse.json({
      team: { id: data.team_id, slug: data.team_slug },
    });
  };
}

export const POST = createAcceptInviteHandler();

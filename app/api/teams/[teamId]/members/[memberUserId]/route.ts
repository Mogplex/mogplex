import { NextResponse } from "next/server";
import { requireProfileId } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  canChangeMemberRole,
  canRemoveMember,
  loadTeamMembershipAuth,
} from "@/lib/team-management";
import { recordTeamAuditEvent } from "@/lib/team-audit";
import type { TeamRole } from "@/lib/team-capabilities";
import type { RecordTeamAuditEventInput } from "@/lib/team-audit";

const MEMBER_ROLES = new Set<TeamRole>([
  "owner",
  "admin",
  "developer",
  "viewer",
]);

async function loadTargetRole(teamId: string, memberUserId: string) {
  const { data, error } = await supabaseAdmin
    .from("team_members")
    .select("role")
    .eq("team_id", teamId)
    .eq("user_id", memberUserId)
    .maybeSingle();

  if (error || !data) return null;
  return data.role as TeamRole;
}

type TeamMemberRouteContext = {
  params: Promise<{ teamId: string; memberUserId: string }>;
};

type TeamMemberRouteDeps = {
  requireProfileId: typeof requireProfileId;
  loadTeamMembershipAuth: typeof loadTeamMembershipAuth;
  loadTargetRole: typeof loadTargetRole;
  updateMemberRole: (
    teamId: string,
    memberUserId: string,
    role: TeamRole
  ) => Promise<{ error: { message: string } | null }>;
  deleteMember: (
    teamId: string,
    memberUserId: string
  ) => Promise<{ error: { message: string } | null }>;
  recordTeamAuditEvent: (input: RecordTeamAuditEventInput) => Promise<unknown>;
};

const defaultTeamMemberRouteDeps: TeamMemberRouteDeps = {
  requireProfileId,
  loadTeamMembershipAuth,
  loadTargetRole,
  async updateMemberRole(teamId, memberUserId, role) {
    const { error } = await supabaseAdmin
      .from("team_members")
      .update({ role })
      .eq("team_id", teamId)
      .eq("user_id", memberUserId);
    return { error: error ? { message: error.message } : null };
  },
  async deleteMember(teamId, memberUserId) {
    const { error } = await supabaseAdmin
      .from("team_members")
      .delete()
      .eq("team_id", teamId)
      .eq("user_id", memberUserId);
    return { error: error ? { message: error.message } : null };
  },
  recordTeamAuditEvent,
};

export function createTeamMemberPatchHandler(
  overrides: Partial<TeamMemberRouteDeps> = {}
) {
  const deps: TeamMemberRouteDeps = {
    ...defaultTeamMemberRouteDeps,
    ...overrides,
  };

  return async function PATCH(
    request: Request,
    context: TeamMemberRouteContext
  ) {
    const profileId = await deps.requireProfileId();
    if (profileId instanceof Response) return profileId;

    const { teamId, memberUserId } = await context.params;
    const auth = await deps.loadTeamMembershipAuth(teamId, profileId);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    let body: { role?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const nextRole = typeof body.role === "string" ? body.role : "";
    if (!MEMBER_ROLES.has(nextRole as TeamRole)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 422 });
    }

    if (memberUserId === profileId) {
      return NextResponse.json(
        { error: "You cannot change your own role" },
        { status: 403 }
      );
    }

    const targetRole = await deps.loadTargetRole(teamId, memberUserId);
    if (!targetRole) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    if (!canChangeMemberRole(auth.role, targetRole, nextRole as TeamRole)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { error } = await deps.updateMemberRole(
      teamId,
      memberUserId,
      nextRole as TeamRole
    );

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await deps.recordTeamAuditEvent({
      productTeamId: teamId,
      actorUserId: profileId,
      action: "member.role_changed",
      targetType: "member",
      targetId: memberUserId,
      payload: {
        from_role: targetRole,
        to_role: nextRole,
      },
    });

    return NextResponse.json({ ok: true });
  };
}

export function createTeamMemberDeleteHandler(
  overrides: Partial<TeamMemberRouteDeps> = {}
) {
  const deps: TeamMemberRouteDeps = {
    ...defaultTeamMemberRouteDeps,
    ...overrides,
  };

  return async function DELETE(
    _request: Request,
    context: TeamMemberRouteContext
  ) {
    const profileId = await deps.requireProfileId();
    if (profileId instanceof Response) return profileId;

    const { teamId, memberUserId } = await context.params;
    const auth = await deps.loadTeamMembershipAuth(teamId, profileId);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    if (memberUserId === profileId) {
      return NextResponse.json(
        { error: "You cannot remove yourself" },
        { status: 403 }
      );
    }

    const targetRole = await deps.loadTargetRole(teamId, memberUserId);
    if (!targetRole) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    if (!canRemoveMember(auth.role, targetRole)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { error } = await deps.deleteMember(teamId, memberUserId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await deps.recordTeamAuditEvent({
      productTeamId: teamId,
      actorUserId: profileId,
      action: "member.removed",
      targetType: "member",
      targetId: memberUserId,
      payload: {
        role: targetRole,
      },
    });

    return NextResponse.json({ ok: true });
  };
}

export const PATCH = createTeamMemberPatchHandler();
export const DELETE = createTeamMemberDeleteHandler();

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { TeamRole } from "@/lib/team-capabilities";

export type TeamAdminRole = Extract<TeamRole, "owner" | "admin">;

export type TeamMembershipAuth =
  | {
      ok: true;
      role: TeamRole;
      canManage: boolean;
    }
  | {
      ok: false;
      status: 403 | 404 | 500;
      error: string;
    };

type TeamMembershipAuthDeps = {
  loadTeam: (teamId: string) => Promise<{
    data: { id: string } | null;
    error: { message: string } | null;
  }>;
  loadMembership: (
    teamId: string,
    profileId: string
  ) => Promise<{
    data: { role: TeamRole } | null;
    error: { message: string } | null;
  }>;
  logError: (message: string, error: { message: string }) => void;
};

const defaultTeamMembershipAuthDeps: TeamMembershipAuthDeps = {
  async loadTeam(teamId) {
    const { data, error } = await supabaseAdmin
      .from("teams")
      .select("id")
      .eq("id", teamId)
      .maybeSingle();
    return {
      data: data as { id: string } | null,
      error: error ? { message: error.message } : null,
    };
  },
  async loadMembership(teamId, profileId) {
    const { data, error } = await supabaseAdmin
      .from("team_members")
      .select("role")
      .eq("team_id", teamId)
      .eq("user_id", profileId)
      .maybeSingle();
    return {
      data: data as { role: TeamRole } | null,
      error: error ? { message: error.message } : null,
    };
  },
  logError(message, error) {
    console.error(message, error);
  },
};

export function createLoadTeamMembershipAuth(
  overrides: Partial<TeamMembershipAuthDeps> = {}
) {
  const deps: TeamMembershipAuthDeps = {
    ...defaultTeamMembershipAuthDeps,
    ...overrides,
  };

  return async function loadTeamMembershipAuth(
    teamId: string,
    profileId: string
  ): Promise<TeamMembershipAuth> {
    const [teamResult, membershipResult] = await Promise.all([
      deps.loadTeam(teamId),
      deps.loadMembership(teamId, profileId),
    ]);

    if (teamResult.error) {
      deps.logError("Team lookup failed", teamResult.error);
      return { ok: false, status: 500, error: "Internal server error" };
    }
    if (!teamResult.data) {
      return { ok: false, status: 404, error: "Team not found" };
    }
    if (membershipResult.error) {
      deps.logError("Team membership lookup failed", membershipResult.error);
      return {
        ok: false,
        status: 500,
        error: "Internal server error",
      };
    }
    if (!membershipResult.data) {
      return { ok: false, status: 403, error: "Forbidden" };
    }

    const role = membershipResult.data.role;
    return {
      ok: true,
      role,
      canManage: role === "owner" || role === "admin",
    };
  };
}

export const loadTeamMembershipAuth = createLoadTeamMembershipAuth();

export function canChangeMemberRole(
  actorRole: TeamRole,
  targetRole: TeamRole,
  nextRole: TeamRole
) {
  if (targetRole === "owner" || nextRole === "owner") return false;
  if (actorRole === "owner") return true;
  if (actorRole !== "admin") return false;
  if (targetRole === "admin" || nextRole === "admin") return false;
  return nextRole === "developer" || nextRole === "viewer";
}

export function canRemoveMember(actorRole: TeamRole, targetRole: TeamRole) {
  if (targetRole === "owner") return false;
  if (actorRole === "owner") return true;
  return actorRole === "admin" && targetRole !== "admin";
}

export function canInviteRole(actorRole: TeamRole, inviteRole: TeamRole) {
  if (inviteRole === "owner") return false;
  if (actorRole === "owner") return true;
  if (actorRole !== "admin") return false;
  return inviteRole === "developer" || inviteRole === "viewer";
}

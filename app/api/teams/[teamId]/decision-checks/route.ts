import { NextResponse } from "next/server";
import { requireProfileId } from "@/lib/auth";
import { decisionChecksEnabled } from "@/lib/decisions/account-setting";
import {
  handleDecisionChecksGet,
  handleDecisionChecksPatch,
  type DecisionChecksAccess,
  type DecisionChecksHandlerDeps,
} from "@/lib/decisions/account-setting-handlers";
import {
  readDecisionChecksSetting,
  writeDecisionChecksSetting,
} from "@/lib/decisions/account-setting-store";
import { recordTeamAuditEvent } from "@/lib/team-audit";
import { loadTeamMembershipAuth } from "@/lib/team-management";

type TeamDeps = DecisionChecksHandlerDeps & {
  /** Resolves the signed-in profile id, or the response that turns them away. */
  requireProfileId: () => Promise<string | Response>;
  loadTeamMembershipAuth: typeof loadTeamMembershipAuth;
};

const defaultDeps: TeamDeps = {
  requireProfileId,
  loadTeamMembershipAuth,
  read: readDecisionChecksSetting,
  write: writeDecisionChecksSetting,
  forget: decisionChecksEnabled.forget,
  onChanged: async (change) => {
    await recordTeamAuditEvent({
      productTeamId: change.owner.id,
      actorUserId: change.actorId,
      action: "decision_checks.changed",
      targetType: "team",
      targetId: change.owner.id,
      payload: { from_enabled: change.from, to_enabled: change.to },
    });
  },
};

type RouteContext = { params: Promise<{ teamId: string }> };

/**
 * The team's choice. Any member can read it; only an owner or admin can
 * change it, and every change is written to the team's audit log.
 */
export function createTeamDecisionChecksHandlers(
  overrides: Partial<TeamDeps> = {}
) {
  const deps = { ...defaultDeps, ...overrides };
  const resolveAccess = async (
    context: RouteContext
  ): Promise<DecisionChecksAccess> => {
    const profileId = await deps.requireProfileId();
    if (profileId instanceof Response) {
      return { ok: false, response: profileId };
    }
    const { teamId } = await context.params;
    const auth = await deps.loadTeamMembershipAuth(teamId, profileId);
    if (!auth.ok) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: auth.error },
          { status: auth.status }
        ),
      };
    }
    return {
      ok: true,
      owner: { table: "teams", id: teamId },
      canManage: auth.canManage,
      actorId: profileId,
    };
  };
  return {
    async GET(_request: Request, context: RouteContext) {
      return handleDecisionChecksGet(await resolveAccess(context), deps);
    },
    async PATCH(request: Request, context: RouteContext) {
      return handleDecisionChecksPatch(
        request,
        await resolveAccess(context),
        deps
      );
    },
  };
}

export const { GET, PATCH } = createTeamDecisionChecksHandlers();

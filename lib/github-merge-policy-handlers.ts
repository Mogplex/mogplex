import { requireProfileId } from "@/lib/auth";
import { loadTeamMembershipAuth } from "@/lib/team-management";

type MergeSettingsDeps = {
  requireProfileId: typeof requireProfileId;
  loadTeamMembershipAuth: typeof loadTeamMembershipAuth;
};

/** Keep old clients from saving controls that no longer govern merges. */
export function createMergeSettingsHandlers(
  overrides: Partial<MergeSettingsDeps> = {}
) {
  const deps = { requireProfileId, loadTeamMembershipAuth, ...overrides };
  async function retired(teamId: string) {
    const userId = await deps.requireProfileId();
    if (userId instanceof Response) return userId;
    const auth = await deps.loadTeamMembershipAuth(teamId, userId);
    if (!auth.ok)
      return Response.json({ error: auth.error }, { status: auth.status });
    return Response.json(
      {
        error:
          "Agent merge settings have been removed. Ask your agent to merge the pull request.",
      },
      { status: 410 }
    );
  }
  return {
    get: retired,
    patch: (_request: Request, teamId: string) => retired(teamId),
    resolve: (_request: Request, teamId: string, _approvalId: string) =>
      retired(teamId),
  };
}

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

type PersonalDeps = DecisionChecksHandlerDeps & {
  /** Resolves the signed-in profile id, or the response that turns them away. */
  requireProfileId: () => Promise<string | Response>;
};

const defaultDeps: PersonalDeps = {
  requireProfileId,
  read: readDecisionChecksSetting,
  write: writeDecisionChecksSetting,
  forget: decisionChecksEnabled.forget,
};

/**
 * The signed-in person's own choice, which governs their work outside a
 * team. Work inside a team follows the team's setting instead.
 */
export function createPersonalDecisionChecksHandlers(
  overrides: Partial<PersonalDeps> = {}
) {
  const deps = { ...defaultDeps, ...overrides };
  const resolveAccess = async (): Promise<DecisionChecksAccess> => {
    const profileId = await deps.requireProfileId();
    if (profileId instanceof Response) {
      return { ok: false, response: profileId };
    }
    return {
      ok: true,
      owner: { table: "profiles", id: profileId },
      canManage: true,
      actorId: profileId,
    };
  };
  return {
    async GET() {
      return handleDecisionChecksGet(await resolveAccess(), deps);
    },
    async PATCH(request: Request) {
      return handleDecisionChecksPatch(request, await resolveAccess(), deps);
    },
  };
}

export const { GET, PATCH } = createPersonalDecisionChecksHandlers();

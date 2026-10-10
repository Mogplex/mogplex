import {
  getSlackInstallationByTeamId,
  getSlackUserMapping,
} from "@/lib/slack/installations";
import { resolveSlackCommandUserId } from "@/lib/slack/command-identity";
import { canRecoverConnection, recoveryAuthorizePath } from "./access";
import { loadConnectionRecoveryRequest } from "./store";

const defaultDeps = {
  getInstallation: getSlackInstallationByTeamId,
  getMapping: getSlackUserMapping,
  loadRequest: loadConnectionRecoveryRequest,
  canRecover: canRecoverConnection,
  authorizePath: recoveryAuthorizePath,
};

export async function resolveConnectionRecoveryBrowser(
  input: { requestId: string; userId: string },
  overrides: Partial<typeof defaultDeps> = {}
) {
  const deps = { ...defaultDeps, ...overrides };
  const request = await deps.loadRequest(input.requestId, input.userId);
  if (request?.user_id !== input.userId) return null;
  const installation = await deps.getInstallation(request.payload.teamId);
  if (installation?.id !== request.slack_installation_id) return null;
  const mapping = await deps.getMapping({
    installationId: installation.id,
    slackUserId: request.payload.slackUserId,
  });
  if (
    resolveSlackCommandUserId(
      installation,
      mapping,
      request.payload.slackUserId
    ) !== input.userId
  )
    return null;
  if (
    !(await deps.canRecover(
      input.userId,
      request.product_team_id,
      request.target.provider
    ))
  )
    return null;
  const authorizePath = await deps.authorizePath(request);
  if (!authorizePath) return null;
  const slackUrl = new URL("https://slack.com/app_redirect");
  slackUrl.searchParams.set("team", request.payload.teamId);
  slackUrl.searchParams.set("channel", request.payload.channelId);
  return { authorizePath, slackUrl: slackUrl.toString() };
}

import { buildAppUrl } from "@/lib/app-url";
import { postSlackMessage } from "@/lib/slack/client";
import type { SlackEventTaskPayload } from "@/trigger/slack-event-lib/types";
import { canRecoverConnection, describeRecoveryConnector } from "./access";
import {
  buildConnectionRecoveryCard,
  connectionRecoveryTargetSchema,
  type ConnectionRecoveryTarget,
} from "./presentation";
import { saveConnectionRecoveryRequest } from "./store";

export type RequestSlackConnectionInput = {
  userId: string;
  installationId: string;
  botToken: string;
  payload: SlackEventTaskPayload;
  target: ConnectionRecoveryTarget;
  resumeText: string;
  productTeamId?: string | null;
  repoId?: string | null;
};

const defaultDeps = {
  canRecover: canRecoverConnection,
  saveRequest: saveConnectionRecoveryRequest,
  describe: describeRecoveryConnector,
  postMessage: postSlackMessage,
  appUrl: () => buildAppUrl("/").origin,
};

export async function requestSlackConnectionRecovery(
  input: RequestSlackConnectionInput,
  overrides: Partial<typeof defaultDeps> = {}
) {
  const deps = { ...defaultDeps, ...overrides };
  const target = connectionRecoveryTargetSchema.parse(input.target);
  if (
    !(await deps.canRecover(
      input.userId,
      input.productTeamId ?? null,
      target.provider
    ))
  ) {
    return {
      ok: false as const,
      error:
        "Your Mogplex team role does not allow this connection. Ask a team owner to update your access.",
    };
  }
  const request = await deps.saveRequest({
    user_id: input.userId,
    slack_installation_id: input.installationId,
    target,
    payload: input.payload,
    resume_text: input.resumeText,
    product_team_id: input.productTeamId ?? null,
    repo_id: input.repoId ?? null,
  });
  const descriptor = await deps.describe(request);
  if (target.provider === "connection" && !descriptor.name)
    return {
      ok: false as const,
      error: "Connection not found in your account.",
    };
  const card = buildConnectionRecoveryCard({
    id: request.id,
    target,
    appUrl: deps.appUrl(),
    ...descriptor,
  });
  await deps.postMessage(input.botToken, {
    channel: input.payload.channelId,
    thread_ts: input.payload.threadTs || input.payload.messageTs,
    ...card,
    unfurl_links: false,
  });
  return {
    ok: true as const,
    requestId: request.id,
    message:
      "A connector card is in this Slack thread. Open it to authorize access, then use Check access & continue in the dialog. Your request is saved.",
  };
}

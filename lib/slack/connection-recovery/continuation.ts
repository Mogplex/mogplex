import type { SlackEventTaskPayload } from "@/trigger/slack-event-lib/types";
import { loadConnectionRecoveryRequest } from "./store";
import { canRecoverConnection } from "./access";

const defaultDeps = {
  loadRequest: loadConnectionRecoveryRequest,
  canRecover: canRecoverConnection,
};

/** Recheck the binding when the queued turn starts, not just when it is clicked. */
export async function validateConnectionContinuation(
  input: {
    payload: SlackEventTaskPayload;
    userId: string;
    installationId: string;
  },
  overrides: Partial<typeof defaultDeps> = {}
) {
  const id = input.payload.connectionRecoveryRequestId;
  if (!id) return false;
  const deps = { ...defaultDeps, ...overrides };
  const saved = await deps.loadRequest(id, input.userId);
  if (
    saved?.user_id !== input.userId ||
    saved.slack_installation_id !== input.installationId
  )
    return false;
  const original = saved.payload;
  const current = input.payload;
  if (
    current.connectionRecoveryRepository !==
    (saved.target.provider === "github" ? saved.target.repository : undefined)
  )
    return false;
  if (
    current.eventId !== `slack-connection:${saved.id}` ||
    current.teamId !== original.teamId ||
    current.channelId !== original.channelId ||
    current.threadTs !== original.threadTs ||
    current.slackUserId !== original.slackUserId
  )
    return false;
  return deps.canRecover(
    input.userId,
    saved.product_team_id,
    saved.target.provider
  );
}

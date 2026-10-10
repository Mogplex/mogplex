import type { SlackBlockActionsPayload } from "@/lib/slack/interactivity";
import type { SlackInstallationRow } from "@/lib/slack/installations";
import type { ConnectionRecoveryRequest } from "./store";
import { CONNECTION_CONTINUE_ACTION } from "./presentation";

export const installation: SlackInstallationRow = {
  id: "00000000-0000-4000-8000-000000000002",
  team_id: "T1",
  team_name: "Workspace",
  installed_by_user_id: "00000000-0000-4000-8000-000000000001",
  bot_user_id: "B1",
  vault_bot_token_id: "vault",
  authed_user_slack_id: "U1",
  scopes: ["chat:write"],
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
};
export function recoveryRequest(): ConnectionRecoveryRequest {
  return {
    id: "00000000-0000-4000-8000-000000000003",
    user_id: installation.installed_by_user_id,
    slack_installation_id: installation.id,
    request_key: "key",
    target: { provider: "github", repository: "acme/widgets", access: "write" },
    payload: {
      teamId: "T1",
      channelId: "D1",
      threadTs: "10.1",
      messageTs: "10.2",
      eventId: "Ev1",
      slackUserId: "U1",
      text: "Fix widgets",
      channelType: "im",
      eventType: "message",
    },
    resume_text: "Fix acme/widgets and open a PR.",
    product_team_id: null,
    repo_id: null,
    dispatched_at: null,
  };
}
export function recoveryAction(
  actionId = CONNECTION_CONTINUE_ACTION
): SlackBlockActionsPayload {
  return {
    type: "block_actions",
    team: { id: "T1" },
    user: { id: "U1" },
    trigger_id: "trigger",
    view: { id: "V1", private_metadata: recoveryRequest().id },
    actions: [{ action_id: actionId, value: recoveryRequest().id }],
  };
}

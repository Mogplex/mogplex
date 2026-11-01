import type { SlackBlock } from "./client";

export const SLACK_STOP_REQUEST_ACTION = "mogplex_stop_request";
export const SLACK_REQUEST_MESSAGE_KEY = "slackConversationalPlaceholder";
export const SLACK_REQUEST_OWNER_KEY = "slackConversationalUserId";

export function buildSlackRequestStatus(
  text: string,
  runtimeRunId?: string
): SlackBlock[] {
  return [
    { type: "context", elements: [{ type: "mrkdwn", text }] },
    ...(runtimeRunId
      ? [
          {
            type: "actions",
            elements: [
              {
                type: "button",
                action_id: SLACK_STOP_REQUEST_ACTION,
                value: runtimeRunId,
                text: { type: "plain_text", text: "Stop request" },
              },
            ],
          },
        ]
      : []),
  ];
}

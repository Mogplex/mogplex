import { z } from "zod";
import { parseCommand } from "@/lib/slack/command-parse";
import {
  SLACK_COMMAND_SELECT_ACTION_ID,
  SLACK_MODEL_SELECT_ACTION_ID,
  SLACK_REPO_SELECT_ACTION_ID,
  SLACK_REFRESH_PRS_ACTION_ID,
  SLACK_MERGE_PR_ACTION_ID,
} from "@/lib/slack/command-actions";
import { SLACK_CHECKPOINT_APPROVE_ACTION_ID } from "@/lib/slack/run-checkpoint-presentation";
import { SLACK_CANCEL_RUN_ACTION_ID } from "@/lib/slack/run-controls";
import {
  hasCompleteSlackEventIdentity,
  isSlackWorkObjectEvent,
  shouldDispatchSlackEvent,
  type SlackWebhookDispatchInput,
} from "./event-types";
import { parseSlackCommand } from "./verified-dispatch";

const identity = z.object({ id: z.string().min(1) }).passthrough();
// Everything else stays on the edge, including new actions, until its
// trigger_id/response deadline requirements have been reviewed.
const DURABLE_ACTIONS = new Set([
  SLACK_COMMAND_SELECT_ACTION_ID,
  SLACK_MODEL_SELECT_ACTION_ID,
  SLACK_REPO_SELECT_ACTION_ID,
  SLACK_REFRESH_PRS_ACTION_ID,
  SLACK_MERGE_PR_ACTION_ID,
  SLACK_CHECKPOINT_APPROVE_ACTION_ID,
  SLACK_CANCEL_RUN_ACTION_ID,
]);
const eventSchema = z
  .object({
    type: z.literal("event_callback"),
    team_id: z.string().min(1),
    event_id: z.string().min(1),
    event: z
      .object({
        type: z.string(),
        channel: z.string().optional(),
        user: z.string().optional(),
        text: z.string().optional(),
        ts: z.string().optional(),
        thread_ts: z.string().optional(),
        channel_type: z.enum(["im", "mpim", "channel", "group"]).optional(),
        bot_id: z.string().optional(),
        subtype: z.string().optional(),
        files: z
          .array(
            z
              .object({
                id: z.string().optional(),
                mimetype: z.string().optional(),
                url_private_download: z.string().optional(),
                name: z.string().optional(),
                size: z.number().optional(),
                filetype: z.string().optional(),
                mode: z.string().optional(),
              })
              .passthrough()
          )
          .optional(),
      })
      .passthrough(),
  })
  .passthrough();

const interactionSchema = z
  .object({
    type: z.literal("block_actions"),
    team: identity,
    user: identity,
    channel: identity.optional(),
    container: z
      .object({ channel_id: z.string().optional() })
      .passthrough()
      .optional(),
    response_url: z.string().optional(),
    trigger_id: z.string().optional(),
    actions: z.array(
      z
        .object({
          action_id: z.string(),
          value: z.string().optional(),
          selected_option: z
            .object({ value: z.string() })
            .passthrough()
            .optional(),
        })
        .passthrough()
    ),
  })
  .passthrough();

/** Run this at both ingress boundaries: hosted filters are an optimization,
 * not a runtime schema or an authorization boundary.
 */
export function parseDurableSlackWebhook(
  rawBody: string,
  contentType: string
): SlackWebhookDispatchInput | null {
  try {
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const params = new URLSearchParams(rawBody);
      if (params.has("command")) {
        const body = parseSlackCommand(params);
        if (!body) return null;
        const command = parseCommand(body);
        // Help returns its UI in the ACK. Issue creation consumes a short-lived trigger_id.
        if (
          !command ||
          command.name === "help" ||
          (command.name === "issues" && command.argument === "create")
        )
          return null;
        return { kind: "command", body, rawBody };
      }
      const parsed = interactionSchema.safeParse(
        JSON.parse(params.get("payload") ?? "null")
      );
      if (!parsed.success) return null;
      if (
        parsed.data.actions.length === 0 ||
        parsed.data.actions.some(
          (action) => !DURABLE_ACTIONS.has(action.action_id)
        )
      )
        return null;
      return { kind: "interactivity", body: parsed.data, rawBody };
    }
    const parsed = eventSchema.safeParse(JSON.parse(rawBody));
    if (
      !parsed.success ||
      !hasCompleteSlackEventIdentity(parsed.data) ||
      isSlackWorkObjectEvent(parsed.data.event) ||
      !shouldDispatchSlackEvent(parsed.data.event)
    )
      return null;
    return { kind: "event", body: parsed.data, rawBody };
  } catch {
    return null;
  }
}

/** Trigger parses form bodies into a record; reconstruct only for parsing,
 * never for provider signature verification.
 */
export function parseNativeSlackEvent(
  event: unknown
): SlackWebhookDispatchInput | null {
  const form = z.record(z.string(), z.string()).safeParse(event);
  if (form.success && ("command" in form.data || "payload" in form.data)) {
    return parseDurableSlackWebhook(
      new URLSearchParams(form.data).toString(),
      "application/x-www-form-urlencoded"
    );
  }
  return parseDurableSlackWebhook(JSON.stringify(event), "application/json");
}

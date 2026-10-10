import { z } from "zod";
import type { SlackBlock } from "@/lib/slack/client";
import type { SlackEventTaskPayload } from "@/trigger/slack-event-lib/types";

export const CONNECTION_OPEN_ACTION = "mogplex_connection_open";
export const CONNECTION_CONTINUE_ACTION = "mogplex_connection_continue";
export const CONNECTION_AUTHORIZE_ACTION = "mogplex_connection_authorize";
export const CONNECTION_RESTORE_ACTION = "mogplex_connection_restore";
export const CONNECTION_SCOPE_ACTION = "mogplex_connection_scope";

export const connectionRecoveryTargetSchema = z.discriminatedUnion("provider", [
  z.object({
    provider: z.literal("github"),
    repository: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9_.-]+$/)
      .refine((value) => ![".", ".."].includes(value.split("/")[1]))
      .optional(),
    access: z.enum(["read", "write"]).default("read"),
  }),
  z.object({
    provider: z.literal("vercel"),
    team: z
      .string()
      .regex(/^[A-Za-z0-9_-]+$/)
      .optional(),
  }),
  z.object({
    provider: z.literal("connection"),
    connectionId: z.string().uuid(),
  }),
]);

export type ConnectionRecoveryTarget = z.infer<
  typeof connectionRecoveryTargetSchema
>;
export type RecoveryPresentation = {
  id: string;
  target: ConnectionRecoveryTarget;
  appUrl: string;
  name?: string;
  icon?: string;
  restoreRepository?: boolean;
  scopeRepair?: { label: string; explanation: string };
};

function connectorName(input: RecoveryPresentation) {
  return input.target.provider === "github"
    ? "GitHub"
    : input.target.provider === "vercel"
      ? "Vercel"
      : (input.name ?? "Connection");
}

function connectorIcon(input: RecoveryPresentation) {
  const icon =
    input.target.provider === "connection"
      ? (input.icon ?? "connection")
      : input.target.provider;
  return new URL(`/slack-connectors/${icon}.png`, input.appUrl).toString();
}

function requestedAccess(target: ConnectionRecoveryTarget) {
  if (target.provider === "github") {
    return target.repository
      ? `${target.repository}${target.access === "write" ? " — code and pull request access" : " — repository access"}`
      : "Your GitHub account and the repositories you choose";
  }
  if (target.provider === "vercel")
    return target.team
      ? `Projects in Vercel team ${target.team}`
      : "Your Vercel projects";
  return "The account and resources you select with this provider";
}

function button(text: string, actionId: string, id: string) {
  return {
    type: "button",
    text: { type: "plain_text", text },
    action_id: actionId,
    value: id,
  };
}

export function connectionRecoveryPath(id: string) {
  return `/slack/connections?request=${encodeURIComponent(id)}`;
}

export function buildConnectionRecoveryCard(input: RecoveryPresentation): {
  text: string;
  blocks: SlackBlock[];
} {
  const name = connectorName(input);
  const text = input.restoreRepository
    ? `This GitHub repository is removed from Mogplex. Restore it to continue: ${requestedAccess(input.target)}.`
    : `Connect ${name} to continue: ${requestedAccess(input.target)}.`;
  return {
    text,
    blocks: [
      {
        type: "section",
        text: { type: "plain_text", text },
        accessory: {
          type: "image",
          image_url: connectorIcon(input),
          alt_text: name,
        },
      },
      {
        type: "actions",
        elements: [
          {
            ...button(
              (input.restoreRepository
                ? "Restore repository"
                : `Connect ${name}`
              ).slice(0, 75),
              CONNECTION_OPEN_ACTION,
              input.id
            ),
            style: "primary",
          },
        ],
      },
    ],
  };
}

export function buildConnectionRecoveryModal(
  input: RecoveryPresentation & {
    status?: string;
    loading?: boolean;
    completed?: boolean;
  }
) {
  const name = connectorName(input);
  return {
    type: "modal",
    title: {
      type: "plain_text",
      text: input.restoreRepository
        ? "Restore repository"
        : "Authorize connection",
    },
    close: { type: "plain_text", text: "Close" },
    callback_id: "mogplex_connection_recovery",
    private_metadata: input.id,
    blocks: [
      {
        type: "context",
        elements: [
          { type: "image", image_url: connectorIcon(input), alt_text: name },
          { type: "plain_text", text: name },
        ],
      },
      {
        type: "section",
        text: {
          type: "plain_text",
          text: `Requested access\n${requestedAccess(input.target)}`,
        },
      },
      {
        type: "section",
        text: {
          type: "plain_text",
          text:
            input.status ??
            (input.restoreRepository
              ? "This repository is hidden in Mogplex. Restore it here, then Mogplex will check GitHub access before continuing your saved request."
              : "Authorize with the provider, then check access here. Mogplex will continue your saved request in the original thread."),
        },
      },
      ...(input.loading || input.completed
        ? []
        : [
            {
              type: "actions",
              elements: input.restoreRepository
                ? [
                    {
                      ...button(
                        "Restore & check access",
                        CONNECTION_RESTORE_ACTION,
                        input.id
                      ),
                      style: "primary",
                    },
                  ]
                : [
                    ...(input.scopeRepair
                      ? [
                          {
                            ...button(
                              input.scopeRepair.label,
                              CONNECTION_SCOPE_ACTION,
                              input.id
                            ),
                            confirm: {
                              title: {
                                type: "plain_text",
                                text: "Update connection scope",
                              },
                              text: {
                                type: "plain_text",
                                text: input.scopeRepair.explanation,
                              },
                              confirm: { type: "plain_text", text: "Update" },
                              deny: { type: "plain_text", text: "Cancel" },
                            },
                          },
                        ]
                      : []),
                    {
                      ...button(
                        `Authorize ${name}`.slice(0, 75),
                        CONNECTION_AUTHORIZE_ACTION,
                        input.id
                      ),
                      style: "primary",
                      url: new URL(
                        connectionRecoveryPath(input.id),
                        input.appUrl
                      ).toString(),
                    },
                    button(
                      "Check access & continue",
                      CONNECTION_CONTINUE_ACTION,
                      input.id
                    ),
                  ],
            },
          ]),
    ],
  };
}

export function buildConnectionResumePayload(input: {
  id: string;
  payload: SlackEventTaskPayload;
  resumeText: string;
}): SlackEventTaskPayload {
  return {
    ...input.payload,
    eventId: `slack-connection:${input.id}`,
    text: `I checked the connection using the Slack authorization dialog. Continue this saved request, using the thread for context and checking the access needed for each operation:\n\n${input.resumeText}`,
  };
}

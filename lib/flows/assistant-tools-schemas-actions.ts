import { z } from "zod";
import { positionSchema } from "./assistant-tools-schemas";

export const addRunCommandNodeParams = z.object({
  label: z.string(),
  command: z
    .string()
    .min(1)
    .describe(
      "Static shell command to execute in the reusable sandbox. Do not place workflow templates in command source."
    ),
  workingDirectory: z
    .string()
    .optional()
    .describe("Optional repo-relative working directory, such as apps/web."),
  position: positionSchema,
});

export const addSlackMessageNodeParams = z
  .object({
    label: z.string(),
    destination: z
      .enum(["channel", "trigger_thread"])
      .optional()
      .describe(
        "Use trigger_thread to reply to the Slack thread that started the workflow; otherwise use channel."
      ),
    teamId: z
      .string()
      .optional()
      .describe("Connected Slack workspace team id."),
    channelId: z.string().optional().describe("Slack channel id."),
    channelName: z
      .string()
      .optional()
      .describe("Optional channel name used only for display."),
    message: z
      .string()
      .min(1)
      .describe(
        "Message text. Supports {{ path }} templates for trigger metadata, outputs, and workflow state."
      ),
    unfurlLinks: z.boolean().optional(),
    position: positionSchema,
  })
  .superRefine((input, context) => {
    if (input.destination === "trigger_thread") return;
    if (!input.teamId?.trim()) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "channel destination requires teamId",
        path: ["teamId"],
      });
    }
    if (!input.channelId?.trim()) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "channel destination requires channelId",
        path: ["channelId"],
      });
    }
  });

export const addGithubCommentNodeParams = z.object({
  label: z.string(),
  targetNumber: z
    .string()
    .optional()
    .describe(
      "Optional issue/PR number or {{ path }} template. Omit to use the triggering issue or PR."
    ),
  body: z.string().min(1).describe("Templated Markdown comment body."),
  position: positionSchema,
});

export const addGithubIssueNodeParams = z.object({
  label: z.string(),
  title: z.string().min(1).describe("Templated issue title."),
  body: z.string().describe("Templated Markdown issue body."),
  labels: z.array(z.string().min(1)).optional(),
  position: positionSchema,
});

export const addGithubLabelsNodeParams = z
  .object({
    label: z.string(),
    targetNumber: z
      .string()
      .optional()
      .describe(
        "Optional issue/PR number or {{ path }} template. Omit to use the triggering issue or PR."
      ),
    addLabels: z.array(z.string().min(1)).optional(),
    removeLabels: z.array(z.string().min(1)).optional(),
    position: positionSchema,
  })
  .refine(
    (input) =>
      (input.addLabels?.length ?? 0) + (input.removeLabels?.length ?? 0) > 0,
    { message: "At least one label must be added or removed" }
  );

export const addGithubStatusNodeParams = z.object({
  label: z.string(),
  commitSha: z
    .string()
    .optional()
    .describe(
      "Optional commit SHA or {{ path }} template. Omit to use the triggering commit."
    ),
  state: z.enum(["pending", "success", "failure", "error"]),
  context: z.string().min(1).describe("Named GitHub status context."),
  description: z.string().optional().describe("Templated status description."),
  targetUrl: z.string().optional().describe("Templated http(s) details URL."),
  position: positionSchema,
});

export const addGithubReviewNodeParams = z.object({
  label: z.string(),
  pullRequestNumber: z
    .string()
    .optional()
    .describe(
      "Optional PR number or {{ path }} template. Omit to use the triggering pull request."
    ),
  event: z.enum(["COMMENT", "APPROVE", "REQUEST_CHANGES"]),
  body: z.string().min(1).describe("Templated Markdown review body."),
  position: positionSchema,
});

export const addGithubMergeNodeParams = z.object({
  label: z.string(),
  pullRequestNumber: z
    .string()
    .optional()
    .describe(
      "Optional PR number or {{ path }} template. Omit to use the triggering pull request."
    ),
  commitTitle: z
    .string()
    .optional()
    .describe("Optional templated squash commit title."),
  position: positionSchema,
});

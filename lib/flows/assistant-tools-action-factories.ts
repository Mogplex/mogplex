import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./assistant-tools-node-factories";
import {
  addRunCommandNodeParams,
  addSlackMessageNodeParams,
  addGithubCommentNodeParams,
  addGithubIssueNodeParams,
  addGithubLabelsNodeParams,
  addGithubStatusNodeParams,
  addGithubReviewNodeParams,
  addGithubMergeNodeParams,
} from "./assistant-tools-schemas-actions";

export function createAddRunCommandNodeTool(ctx: ToolContext) {
  return tool({
    description:
      "Add a deterministic action that runs a shell command in the trigger branch's sandbox. Sequential command actions reuse the same sandbox workspace.",
    inputSchema: addRunCommandNodeParams,
    execute: async ({
      label,
      command,
      workingDirectory,
      position,
    }: z.infer<typeof addRunCommandNodeParams>) => {
      const hydrationError = ctx.requireGraphHydrated();
      if (hydrationError) return hydrationError;
      const id = ctx.mintId("action");
      ctx.graph.nodes.push({
        id,
        type: "action",
        position: position ?? ctx.autoPosition(),
        data: {
          label,
          operation: "sandbox.run_command",
          command,
          workingDirectory: workingDirectory?.trim() || null,
        },
      });
      return { id };
    },
  });
}

export function createAddSlackMessageNodeTool(ctx: ToolContext) {
  return tool({
    description:
      "Add a deterministic action that posts a templated message to a channel in a connected Slack workspace.",
    inputSchema: addSlackMessageNodeParams,
    execute: async ({
      label,
      destination,
      teamId,
      channelId,
      channelName,
      message,
      unfurlLinks,
      position,
    }: z.infer<typeof addSlackMessageNodeParams>) => {
      const hydrationError = ctx.requireGraphHydrated();
      if (hydrationError) return hydrationError;
      const id = ctx.mintId("action");
      ctx.graph.nodes.push({
        id,
        type: "action",
        position: position ?? ctx.autoPosition(),
        data: {
          label,
          operation: "slack.send_message",
          destination: destination ?? "channel",
          teamId: teamId ?? "",
          channelId: channelId ?? "",
          channelName: channelName?.trim() || null,
          message,
          unfurlLinks: unfurlLinks === true,
        },
      });
      return { id };
    },
  });
}

export function createAddGithubCommentNodeTool(ctx: ToolContext) {
  return tool({
    description:
      "Add a deterministic action that posts a templated comment on the triggering GitHub issue or pull request.",
    inputSchema: addGithubCommentNodeParams,
    execute: async ({
      label,
      targetNumber,
      body,
      position,
    }: z.infer<typeof addGithubCommentNodeParams>) => {
      const hydrationError = ctx.requireGraphHydrated();
      if (hydrationError) return hydrationError;
      const id = ctx.mintId("action");
      ctx.graph.nodes.push({
        id,
        type: "action",
        position: position ?? ctx.autoPosition(),
        data: {
          label,
          operation: "github.post_comment",
          targetNumber: targetNumber?.trim() || null,
          body,
        },
      });
      return { id };
    },
  });
}

export function createAddGithubIssueNodeTool(ctx: ToolContext) {
  return tool({
    description:
      "Add a deterministic action that creates an issue in the workflow repository.",
    inputSchema: addGithubIssueNodeParams,
    execute: async ({
      label,
      title,
      body,
      labels,
      position,
    }: z.infer<typeof addGithubIssueNodeParams>) => {
      const hydrationError = ctx.requireGraphHydrated();
      if (hydrationError) return hydrationError;
      const id = ctx.mintId("action");
      ctx.graph.nodes.push({
        id,
        type: "action",
        position: position ?? ctx.autoPosition(),
        data: {
          label,
          operation: "github.create_issue",
          title,
          body,
          labels: labels ?? [],
        },
      });
      return { id };
    },
  });
}

export function createAddGithubLabelsNodeTool(ctx: ToolContext) {
  return tool({
    description:
      "Add a deterministic action that adds or removes labels on the triggering GitHub issue or pull request.",
    inputSchema: addGithubLabelsNodeParams,
    execute: async ({
      label,
      targetNumber,
      addLabels,
      removeLabels,
      position,
    }: z.infer<typeof addGithubLabelsNodeParams>) => {
      const hydrationError = ctx.requireGraphHydrated();
      if (hydrationError) return hydrationError;
      const id = ctx.mintId("action");
      ctx.graph.nodes.push({
        id,
        type: "action",
        position: position ?? ctx.autoPosition(),
        data: {
          label,
          operation: "github.update_labels",
          targetNumber: targetNumber?.trim() || null,
          addLabels: addLabels ?? [],
          removeLabels: removeLabels ?? [],
        },
      });
      return { id };
    },
  });
}

export function createAddGithubStatusNodeTool(ctx: ToolContext) {
  return tool({
    description:
      "Add a deterministic action that publishes a named GitHub commit status on the triggering commit.",
    inputSchema: addGithubStatusNodeParams,
    execute: async ({
      label,
      commitSha,
      state,
      context,
      description,
      targetUrl,
      position,
    }: z.infer<typeof addGithubStatusNodeParams>) => {
      const hydrationError = ctx.requireGraphHydrated();
      if (hydrationError) return hydrationError;
      const id = ctx.mintId("action");
      ctx.graph.nodes.push({
        id,
        type: "action",
        position: position ?? ctx.autoPosition(),
        data: {
          label,
          operation: "github.set_status",
          commitSha: commitSha?.trim() || null,
          state,
          context,
          description: description?.trim() || null,
          targetUrl: targetUrl?.trim() || null,
        },
      });
      return { id };
    },
  });
}

export function createAddGithubReviewNodeTool(ctx: ToolContext) {
  return tool({
    description:
      "Add a deterministic action that submits a comment, approval, or change request on the triggering pull request.",
    inputSchema: addGithubReviewNodeParams,
    execute: async ({
      label,
      pullRequestNumber,
      event,
      body,
      position,
    }: z.infer<typeof addGithubReviewNodeParams>) => {
      const hydrationError = ctx.requireGraphHydrated();
      if (hydrationError) return hydrationError;
      const id = ctx.mintId("action");
      ctx.graph.nodes.push({
        id,
        type: "action",
        position: position ?? ctx.autoPosition(),
        data: {
          label,
          operation: "github.submit_review",
          pullRequestNumber: pullRequestNumber?.trim() || null,
          event,
          body,
        },
      });
      return { id };
    },
  });
}

export function createAddGithubMergeNodeTool(ctx: ToolContext) {
  return tool({
    description:
      "Add an action that requests a squash merge after the workflow completes. Mogplex waits for its own review check to finish, requires an explicit no-issues verdict for PR-review flows, then merges only when GitHub reports the pull request open, non-draft, conflict-free, and clean under branch protection.",
    inputSchema: addGithubMergeNodeParams,
    execute: async ({
      label,
      pullRequestNumber,
      commitTitle,
      position,
    }: z.infer<typeof addGithubMergeNodeParams>) => {
      const hydrationError = ctx.requireGraphHydrated();
      if (hydrationError) return hydrationError;
      const id = ctx.mintId("action");
      ctx.graph.nodes.push({
        id,
        type: "action",
        position: position ?? ctx.autoPosition(),
        data: {
          label,
          operation: "github.merge_pull_request",
          pullRequestNumber: pullRequestNumber?.trim() || null,
          commitTitle: commitTitle?.trim() || null,
        },
      });
      return { id };
    },
  });
}

import { tool, type Tool } from "ai";
import { z } from "zod";
import type { SlackInstallationRow } from "@/lib/slack/installations";
import type {
  SlackAttribution,
  SlackEventTaskDeps,
  SlackEventTaskPayload,
  SlackRepoContext,
} from "./types";
import {
  buildSlackRepoAgentPrompt,
  prepareSlackRepoAgentAttachments,
} from "./attachments";
import { getSlackReplyThreadTs } from "./channel-state";
import { launchSlackRepoAgentRun } from "./repo-agent-launch";

export const SLACK_START_REPO_AGENT_RUN_TOOL_NAME = "start_repo_agent_run";

const startRepoAgentRunParams = z.object({
  task: z
    .string()
    .min(1)
    .describe(
      "Complete, self-contained instructions for the repo agent: what is broken or wanted, every error message, stack trace, file path, issue or alert link from the conversation, and how to verify the fix. The agent cannot see this Slack conversation."
    ),
  repository: z
    .string()
    .optional()
    .describe(
      "owner/repo of the connected repository to run against. Only set this when the conversation names a repository other than the one already in context."
    ),
});

export type SlackStartRepoAgentRunToolResult =
  | { ok: true; runId: string; runUrl: string; repository: string }
  | { ok: false; error: string };

type LaunchAttempt = {
  /** Settles the per-event slot: a started run or a policy denial. */
  final: boolean;
  result: SlackStartRepoAgentRunToolResult;
};

export function buildSlackDelegatedRunPrompt(input: {
  task: string;
  userText: string;
}) {
  const task = input.task.trim();
  const userText = input.userText.trim();
  if (!userText || userText === task) return task;
  return `${task}\n\n---\nOriginal Slack request from the user, verbatim:\n${userText}`;
}

/**
 * The conversational Slack agent's hand-off to a full repo-agent run. Bound to
 * the inbound Slack event so the run's status message, cancel button, quota
 * reservation, and idempotency all match a linked-channel mention.
 */
export function createSlackStartRepoAgentRunTool(input: {
  deps: SlackEventTaskDeps;
  payload: SlackEventTaskPayload;
  botToken: string;
  mogplexUserId: string;
  attribution: SlackAttribution;
  installation: SlackInstallationRow;
  repoContext: SlackRepoContext | null;
  userText: string;
}): { tool: Tool; getLaunchedRunId: () => string | null } {
  // One run per Slack event. The model may emit several tool calls in one
  // step and the AI SDK executes them concurrently, so the slot is claimed
  // synchronously before the first await: later callers await the same
  // in-flight attempt instead of starting their own. Only a started run or a
  // policy denial settles the slot; a repository lookup miss or a start
  // failure releases it so a corrected follow-up call can try again.
  let settled: SlackStartRepoAgentRunToolResult | null = null;
  let inFlight: Promise<LaunchAttempt> | null = null;

  async function resolveRepo(repository: string | undefined) {
    if (repository?.trim()) {
      const explicit = await input.deps.resolveRepoContext({
        mogplexUserId: input.mogplexUserId,
        texts: [repository.trim()],
      });
      if (explicit) return explicit;
      return {
        error: `"${repository.trim()}" is not one of the user's connected repositories. Ask the user for the exact owner/repo.`,
      };
    }
    if (input.repoContext) return input.repoContext;
    return {
      error:
        "No repository is in context. Ask the user which connected repository (owner/repo) to run against, then call this tool again with `repository`.",
    };
  }

  async function attemptLaunch(
    args: z.infer<typeof startRepoAgentRunParams>
  ): Promise<LaunchAttempt> {
    const repo = await resolveRepo(args.repository);
    if ("error" in repo) {
      return { final: false, result: { ok: false, error: repo.error } };
    }

    const attachments = prepareSlackRepoAgentAttachments(input.payload);
    const prompt = buildSlackRepoAgentPrompt({
      text: buildSlackDelegatedRunPrompt({
        task: args.task,
        userText: input.userText,
      }),
      attachments,
    });
    const result = await launchSlackRepoAgentRun({
      deps: input.deps,
      payload: input.payload,
      botToken: input.botToken,
      mogplexUserId: input.mogplexUserId,
      attribution: input.attribution,
      installation: input.installation,
      repoId: repo.repoId,
      prompt,
      attachments,
      postThreadTs: getSlackReplyThreadTs(input.payload),
    });
    if (result.ok) {
      return {
        final: true,
        result: {
          ok: true,
          runId: result.runId,
          runUrl: result.runUrl,
          repository: repo.repoFullName,
        },
      };
    }
    if (result.kind === "policy_denied") {
      return { final: true, result: { ok: false, error: result.message } };
    }
    return {
      final: false,
      result: {
        ok: false,
        error:
          "The run could not be started. Tell the user to try again or open Mogplex for details.",
      },
    };
  }

  async function execute(
    args: z.infer<typeof startRepoAgentRunParams>
  ): Promise<SlackStartRepoAgentRunToolResult> {
    if (settled) return settled;
    if (inFlight) return (await inFlight).result;

    const attempt = attemptLaunch(args);
    inFlight = attempt;
    try {
      const outcome = await attempt;
      if (outcome.final) settled = outcome.result;
      return outcome.result;
    } finally {
      inFlight = null;
    }
  }

  return {
    tool: tool({
      description:
        "Start a full Mogplex repo-agent run that fixes, implements, or changes code in one of the user's connected repositories and opens a pull request. Use it for any request to fix a bug, resolve an issue or error report, or make a code change. Returns the run link.",
      inputSchema: startRepoAgentRunParams,
      execute,
    }),
    getLaunchedRunId: () => (settled?.ok ? settled.runId : null),
  };
}

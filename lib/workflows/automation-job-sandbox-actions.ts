/**
 * Flow action execution for the automation job workflow.
 * Split from automation-job-sandbox.ts for modularity.
 */

import path from "node:path";
import { getSlackBotToken, postSlackMessage } from "@/lib/slack/client";
import { getSlackInstallationByTeamId } from "@/lib/slack/installations";
import {
  createGithubIssueAction,
  postGithubComment,
  setGithubCommitStatus,
  submitGithubPullRequestReview,
  updateGithubLabels,
} from "@/lib/flows/github-actions";
import type { FlowOperatorActionResult } from "@/lib/flows/operators/types";
import type { FlowActionNodeData } from "@/lib/types";
import type { JobContext } from "@/lib/workflows/automation-job-types";
import { coercePositivePrNumber } from "@/lib/workflows/automation-job-utils";
import {
  buildAutofixSandboxInternalApiHeaders,
  launchAutofixSandbox,
  launchAutomationHarnessSandbox,
} from "@/lib/workflows/automation-job-sandbox-setup";

// Import types for function signatures
import type {
  loadPullRequestDetails,
  resolveAutofixTargetRepo,
} from "@/lib/workflows/automation-job-github";

export type FlowActionRuntimeInput = {
  jobRunId: string;
  nodeId: string;
  action: FlowActionNodeData;
  context: JobContext;
  githubToken: string;
  loadPullRequestDetails: typeof loadPullRequestDetails;
  resolveAutofixTargetRepo: typeof resolveAutofixTargetRepo;
  fetchImpl?: typeof fetch;
};

function resolveActionWorkingDirectory(
  sandboxRootDirectory: string | null,
  configuredDirectory: string | null
) {
  if (!configuredDirectory?.trim()) return sandboxRootDirectory;
  const configured = configuredDirectory.trim();
  if (path.posix.isAbsolute(configured)) {
    throw new Error("Run command working directory must be repo-relative");
  }
  const normalized = path.posix.normalize(configured);
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new Error("Run command working directory must stay inside the repo");
  }
  return sandboxRootDirectory
    ? path.posix.join(sandboxRootDirectory, normalized)
    : normalized;
}

export function resolvePullRequestNumber(
  metadata: Record<string, unknown>
): number | null {
  const direct = coercePositivePrNumber(metadata.pr_number);
  if (direct != null) return direct;

  // GitHub `issue_comment` and `pull_request_review_comment` deliveries set
  // `is_pr: true` and store the PR number in `issue_number`. Honor that so
  // mention / PR-comment triggered fix nodes can resolve their pull request.
  if (metadata.is_pr === true) {
    return coercePositivePrNumber(metadata.issue_number);
  }

  return null;
}

async function launchFlowActionSandbox(input: FlowActionRuntimeInput) {
  const prNumber = resolvePullRequestNumber(input.context.metadata);
  if (prNumber == null) {
    return launchAutomationHarnessSandbox(input.context);
  }

  const pullRequest = await input.loadPullRequestDetails({
    repoFullName: input.context.repo.full_name,
    prNumber,
    githubToken: input.githubToken,
    fallbackHeadRef:
      typeof input.context.metadata.head_ref === "string"
        ? input.context.metadata.head_ref
        : null,
    fallbackHeadSha:
      typeof input.context.metadata.head_sha === "string"
        ? input.context.metadata.head_sha
        : null,
    fallbackHeadRepoFullName:
      typeof input.context.metadata.head_repo_full_name === "string"
        ? input.context.metadata.head_repo_full_name
        : null,
    fallbackBaseRef:
      typeof input.context.metadata.base_ref === "string"
        ? input.context.metadata.base_ref
        : (input.context.repo.default_branch ?? null),
    fallbackBaseSha:
      typeof input.context.metadata.base_sha === "string"
        ? input.context.metadata.base_sha
        : null,
    fallbackBaseRepoFullName:
      typeof input.context.metadata.base_repo_full_name === "string"
        ? input.context.metadata.base_repo_full_name
        : input.context.repo.full_name,
  });
  if (!pullRequest) {
    throw new Error("Run command could not load pull request details");
  }

  const targetRepo = await input.resolveAutofixTargetRepo({
    contextRepo: input.context.repo,
    headRepoFullName: pullRequest.headRepoFullName,
  });
  if (!targetRepo) {
    throw new Error(
      "Run command could not resolve the pull request head repository"
    );
  }

  return launchAutofixSandbox({
    context: input.context,
    pullRequest,
    targetRepo,
  });
}

function resolveActionTargetNumber(
  configured: string | null,
  metadata: Record<string, unknown>,
  target: "issue or pull request" | "pull request"
) {
  const configuredNumber = configured
    ? coercePositivePrNumber(configured)
    : null;
  if (configured && configuredNumber == null) {
    throw new Error(
      `GitHub action ${target} number must resolve to a positive integer`
    );
  }
  if (configuredNumber != null) return configuredNumber;

  const prNumber = resolvePullRequestNumber(metadata);
  if (prNumber != null) return prNumber;
  if (target === "issue or pull request") {
    const issueNumber = coercePositivePrNumber(metadata.issue_number);
    if (issueNumber != null) return issueNumber;
  }
  throw new Error(
    `GitHub action could not resolve the triggering ${target} number`
  );
}

function resolveActionCommitSha(
  configured: string | null,
  metadata: Record<string, unknown>
) {
  const value =
    configured ??
    (typeof metadata.head_sha === "string" ? metadata.head_sha : null);
  const normalized = value?.trim() ?? "";
  if (!/^[a-f0-9]{7,40}$/i.test(normalized)) {
    throw new Error(
      "GitHub status action could not resolve a valid commit SHA"
    );
  }
  return normalized;
}

function requireResolvedActionText(value: string, field: string) {
  if (!value.trim()) {
    throw new Error(`Flow action ${field} resolved to an empty value`);
  }
}

export function resolveSlackTriggerDestination(
  metadata: Record<string, unknown>
) {
  const slack =
    metadata.slack &&
    typeof metadata.slack === "object" &&
    !Array.isArray(metadata.slack)
      ? (metadata.slack as Record<string, unknown>)
      : null;
  const teamId =
    slack && typeof slack.team_id === "string" ? slack.team_id.trim() : "";
  const channelId =
    slack && typeof slack.channel_id === "string"
      ? slack.channel_id.trim()
      : "";
  const threadTs =
    slack && typeof slack.thread_ts === "string" ? slack.thread_ts.trim() : "";
  const messageTs =
    slack && typeof slack.message_ts === "string"
      ? slack.message_ts.trim()
      : "";
  if (!teamId || !channelId || (!threadTs && !messageTs)) {
    throw new Error(
      "Slack thread action requires a Slack-triggered workflow event"
    );
  }
  return {
    teamId,
    channelId,
    threadTs: threadTs || messageTs,
  };
}

export async function runFlowAction(
  input: FlowActionRuntimeInput
): Promise<FlowOperatorActionResult> {
  if (input.action.operation === "slack.send_message") {
    requireResolvedActionText(input.action.message, "Slack message");
    const triggerDestination =
      input.action.destination === "trigger_thread"
        ? resolveSlackTriggerDestination(input.context.metadata)
        : null;
    const teamId = triggerDestination?.teamId ?? input.action.teamId;
    const channelId = triggerDestination?.channelId ?? input.action.channelId;
    const installation = await getSlackInstallationByTeamId(teamId);
    if (installation?.installed_by_user_id !== input.context.repo.user_id) {
      throw new Error("Slack workspace is not connected for this user");
    }
    const botToken = await getSlackBotToken(teamId);
    if (!botToken) {
      throw new Error("Slack workspace bot token is unavailable");
    }
    const posted = await postSlackMessage(
      botToken,
      {
        channel: channelId,
        text: input.action.message,
        thread_ts: triggerDestination?.threadTs,
        unfurl_links: input.action.unfurlLinks === true,
      },
      input.fetchImpl
    );
    const destination = triggerDestination
      ? "the triggering Slack thread"
      : input.action.channelName
        ? `#${input.action.channelName}`
        : channelId;
    return {
      summary: `Sent Slack message to ${destination}`,
      output: {
        team_id: teamId,
        channel_id: posted.channel,
        channel_name: triggerDestination ? null : input.action.channelName,
        message_ts: posted.ts,
        thread_ts: triggerDestination?.threadTs ?? null,
      },
    };
  }

  if (input.action.operation === "github.post_comment") {
    requireResolvedActionText(input.action.body, "GitHub comment body");
    const targetNumber = resolveActionTargetNumber(
      input.action.targetNumber,
      input.context.metadata,
      "issue or pull request"
    );
    const result = await postGithubComment({
      githubToken: input.githubToken,
      repoFullName: input.context.repo.full_name,
      targetNumber,
      body: input.action.body,
      fetchImpl: input.fetchImpl,
    });
    return {
      summary: `Posted GitHub comment on #${targetNumber}`,
      output: {
        target_number: targetNumber,
        comment_id: result.commentId,
        comment_url: result.commentUrl,
      },
    };
  }

  if (input.action.operation === "github.create_issue") {
    requireResolvedActionText(input.action.title, "GitHub issue title");
    const result = await createGithubIssueAction({
      githubToken: input.githubToken,
      repoFullName: input.context.repo.full_name,
      title: input.action.title,
      body: input.action.body,
      labels: input.action.labels,
      fetchImpl: input.fetchImpl,
    });
    return {
      summary: `Created GitHub issue #${result.issueNumber}`,
      output: {
        issue_number: result.issueNumber,
        issue_url: result.issueUrl,
        labels: input.action.labels,
      },
    };
  }

  if (input.action.operation === "github.update_labels") {
    if (
      input.action.addLabels.length === 0 &&
      input.action.removeLabels.length === 0
    ) {
      throw new Error("Flow action GitHub labels resolved to an empty value");
    }
    const targetNumber = resolveActionTargetNumber(
      input.action.targetNumber,
      input.context.metadata,
      "issue or pull request"
    );
    const result = await updateGithubLabels({
      githubToken: input.githubToken,
      repoFullName: input.context.repo.full_name,
      targetNumber,
      addLabels: input.action.addLabels,
      removeLabels: input.action.removeLabels,
      fetchImpl: input.fetchImpl,
    });
    return {
      summary: `Updated GitHub labels on #${targetNumber}`,
      output: {
        target_number: targetNumber,
        added_labels: result.addedLabels,
        removed_labels: result.removedLabels,
        labels: result.labels,
      },
    };
  }

  if (input.action.operation === "github.set_status") {
    requireResolvedActionText(input.action.context, "GitHub status context");
    const commitSha = resolveActionCommitSha(
      input.action.commitSha,
      input.context.metadata
    );
    if (input.action.targetUrl) {
      try {
        const url = new URL(input.action.targetUrl);
        if (!["http:", "https:"].includes(url.protocol)) {
          throw new Error("Unsupported status URL protocol");
        }
      } catch {
        throw new Error("GitHub status target URL must use http(s)");
      }
    }
    const result = await setGithubCommitStatus({
      githubToken: input.githubToken,
      repoFullName: input.context.repo.full_name,
      commitSha,
      state: input.action.state,
      context: input.action.context,
      description: input.action.description,
      targetUrl: input.action.targetUrl,
      fetchImpl: input.fetchImpl,
    });
    return {
      summary: `Set ${result.context} status to ${result.state}`,
      output: {
        status_id: result.statusId,
        status_url: result.statusUrl,
        state: result.state,
        context: result.context,
        commit_sha: result.commitSha,
      },
    };
  }

  if (input.action.operation === "github.submit_review") {
    requireResolvedActionText(input.action.body, "GitHub review body");
    const pullRequestNumber = resolveActionTargetNumber(
      input.action.pullRequestNumber,
      input.context.metadata,
      "pull request"
    );
    const triggeringPullRequestNumber = resolvePullRequestNumber(
      input.context.metadata
    );
    const result = await submitGithubPullRequestReview({
      githubToken: input.githubToken,
      repoFullName: input.context.repo.full_name,
      pullRequestNumber,
      event: input.action.event,
      body: input.action.body,
      commitSha:
        pullRequestNumber === triggeringPullRequestNumber &&
        typeof input.context.metadata.head_sha === "string"
          ? input.context.metadata.head_sha
          : null,
      fetchImpl: input.fetchImpl,
    });
    return {
      summary: `Submitted ${input.action.event.toLowerCase()} review on PR #${pullRequestNumber}`,
      output: {
        pull_request_number: pullRequestNumber,
        review_id: result.reviewId,
        review_url: result.reviewUrl,
        event: input.action.event,
      },
    };
  }

  if (input.action.operation === "github.merge_pull_request") {
    const pullRequestNumber = resolveActionTargetNumber(
      input.action.pullRequestNumber,
      input.context.metadata,
      "pull request"
    );
    return {
      summary: `Requested safe merge for pull request #${pullRequestNumber}`,
      output: {
        pull_request_number: pullRequestNumber,
        auto_merge_requested: true,
        commit_title: input.action.commitTitle,
      },
    };
  }

  if (!input.action.command.trim()) {
    throw new Error("Run command resolved to an empty command");
  }
  if (input.action.command.includes("{{")) {
    throw new Error("Run command cannot use templates in shell commands");
  }
  const sandbox = await launchFlowActionSandbox(input);
  const { createSandboxExecPostHandler } =
    await import("@/app/api/sandbox/[id]/exec/route");
  const response = await createSandboxExecPostHandler()(
    new Request(
      `https://internal.mogplex/api/sandbox/${sandbox.recordId}/exec`,
      {
        method: "POST",
        headers: buildAutofixSandboxInternalApiHeaders(input.context),
        body: JSON.stringify({
          command: input.action.command,
          cwd: resolveActionWorkingDirectory(
            sandbox.rootDirectory,
            input.action.workingDirectory
          ),
        }),
      }
    ),
    { params: Promise.resolve({ id: sandbox.recordId }) }
  );
  const payload = (await response.json()) as {
    error?: unknown;
    exitCode?: unknown;
    stdout?: unknown;
    stderr?: unknown;
    cwd?: unknown;
  };
  if (!response.ok) {
    throw new Error(
      typeof payload.error === "string"
        ? payload.error
        : "Sandbox command failed"
    );
  }
  const exitCode = typeof payload.exitCode === "number" ? payload.exitCode : 1;
  const stdout = typeof payload.stdout === "string" ? payload.stdout : "";
  const stderr = typeof payload.stderr === "string" ? payload.stderr : "";
  if (exitCode !== 0) {
    const detail = stderr.trim() || stdout.trim();
    throw new Error(
      detail
        ? `Command exited with code ${exitCode}: ${detail}`
        : `Command exited with code ${exitCode}`
    );
  }

  return {
    summary: `Command completed: ${input.action.command}`,
    output: {
      sandbox_id: sandbox.recordId,
      runtime_sandbox_id: sandbox.sandboxId,
      command: input.action.command,
      cwd: typeof payload.cwd === "string" ? payload.cwd : null,
      exit_code: exitCode,
      stdout,
      stderr,
    },
  };
}

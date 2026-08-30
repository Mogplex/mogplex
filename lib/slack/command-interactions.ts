import { listMogplexApiRepos } from "@/lib/mogplex-api/repos";
import {
  SLACK_ISSUE_BODY_ACTION_ID,
  SLACK_ISSUE_BODY_BLOCK_ID,
  SLACK_ISSUE_MODAL_CALLBACK_ID,
  SLACK_ISSUE_TITLE_ACTION_ID,
  SLACK_ISSUE_TITLE_BLOCK_ID,
} from "@/lib/slack/command-actions";
import {
  createSlackRepoIssue,
  mergeSlackRepoPullRequest,
} from "@/lib/slack/command-data";
import { getSlackBotToken, postSlackEphemeral } from "@/lib/slack/client";
import { getSlackChannelLink } from "@/lib/slack/channel-links";
import type { SlackBlockActionsPayload } from "@/lib/slack/interactivity";
import {
  getSlackInstallationByTeamId,
  getSlackUserMapping,
  isExplicitSlackUserMapping,
  type SlackInstallationRow,
  type SlackUserMappingRow,
} from "@/lib/slack/installations";
import { postSlackResponse } from "@/lib/slack/response";

type SlackCommandInteractionDeps = {
  getInstallation: typeof getSlackInstallationByTeamId;
  getUserMapping: typeof getSlackUserMapping;
  getChannelLink: typeof getSlackChannelLink;
  listRepos: typeof listMogplexApiRepos;
  mergePullRequest: typeof mergeSlackRepoPullRequest;
  createIssue: typeof createSlackRepoIssue;
  getBotToken: typeof getSlackBotToken;
  postEphemeral: typeof postSlackEphemeral;
  postResponse: typeof postSlackResponse;
};

const defaultDeps: SlackCommandInteractionDeps = {
  getInstallation: getSlackInstallationByTeamId,
  getUserMapping: getSlackUserMapping,
  getChannelLink: getSlackChannelLink,
  listRepos: listMogplexApiRepos,
  mergePullRequest: mergeSlackRepoPullRequest,
  createIssue: createSlackRepoIssue,
  getBotToken: getSlackBotToken,
  postEphemeral: postSlackEphemeral,
  postResponse: postSlackResponse,
};

function resolveMogplexUserId(
  installation: SlackInstallationRow,
  mapping: SlackUserMappingRow | null,
  slackUserId: string
) {
  if (isExplicitSlackUserMapping(mapping)) return mapping.mogplex_user_id;
  if (installation.authed_user_slack_id === slackUserId) {
    return installation.installed_by_user_id;
  }
  return null;
}

async function resolveActor(input: {
  deps: SlackCommandInteractionDeps;
  teamId: string;
  slackUserId: string;
}) {
  const installation = await input.deps.getInstallation(input.teamId);
  if (!installation) return null;
  const mapping = await input.deps.getUserMapping({
    installationId: installation.id,
    slackUserId: input.slackUserId,
  });
  const mogplexUserId = resolveMogplexUserId(
    installation,
    mapping,
    input.slackUserId
  );
  return mogplexUserId ? { installation, mogplexUserId } : null;
}

function readMergeValue(value: string) {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (
      typeof parsed.repoId !== "string" ||
      typeof parsed.number !== "number" ||
      !Number.isSafeInteger(parsed.number) ||
      parsed.number <= 0 ||
      typeof parsed.headSha !== "string" ||
      !/^[a-f\d]{40}$/i.test(parsed.headSha)
    ) {
      return null;
    }
    return {
      repoId: parsed.repoId,
      number: parsed.number,
      headSha: parsed.headSha,
    };
  } catch {
    return null;
  }
}

async function respond(
  deps: SlackCommandInteractionDeps,
  responseUrl: string | undefined,
  text: string
) {
  if (!responseUrl) return;
  await deps.postResponse(responseUrl, {
    response_type: "ephemeral",
    replace_original: false,
    text,
  });
}

export function createSlackPullRequestMergeActionHandler(
  overrides: Partial<SlackCommandInteractionDeps> = {}
) {
  const deps = { ...defaultDeps, ...overrides };
  return async function handleSlackPullRequestMergeAction(
    payload: SlackBlockActionsPayload,
    rawValue: string
  ) {
    const teamId = payload.team?.id;
    const slackUserId = payload.user?.id;
    const channelId = payload.channel?.id ?? payload.container?.channel_id;
    const value = readMergeValue(rawValue);
    if (!teamId || !slackUserId || !channelId || !value) {
      return { outcome: "ignored" as const, reason: "invalid_merge_action" };
    }
    const actor = await resolveActor({ deps, teamId, slackUserId });
    if (!actor) {
      await respond(
        deps,
        payload.response_url,
        "Link your Slack identity to your Mogplex account, then try again."
      );
      return { outcome: "not_linked" as const };
    }
    const link = await deps.getChannelLink({
      installationId: actor.installation.id,
      channelId,
    });
    if (link?.repo_id !== value.repoId) {
      await respond(
        deps,
        payload.response_url,
        "The channel repository changed. Run `/mogplex prs` to refresh before merging."
      );
      return { outcome: "ignored" as const, reason: "stale_repo" };
    }
    const repos = await deps.listRepos(actor.mogplexUserId, {
      id: value.repoId,
      limit: 1,
    });
    const repo = repos[0];
    if (!repo) {
      await respond(
        deps,
        payload.response_url,
        "That repository is no longer available to your Mogplex account."
      );
      return { outcome: "ignored" as const, reason: "repo_unavailable" };
    }
    let result: Awaited<ReturnType<typeof mergeSlackRepoPullRequest>>;
    try {
      result = await deps.mergePullRequest({
        userId: actor.mogplexUserId,
        repo,
        prNumber: value.number,
        expectedHeadSha: value.headSha,
      });
    } catch (error) {
      console.error("[slack-command] pull request merge failed", {
        repoId: repo.id,
        prNumber: value.number,
        error,
      });
      await respond(
        deps,
        payload.response_url,
        `Mogplex could not merge pull request #${value.number} right now. Refresh its status and try again.`
      );
      return { outcome: "ignored" as const, reason: "merge_failed" };
    }
    if (result.merged) {
      await respond(
        deps,
        payload.response_url,
        `Pull request #${value.number} merged.`
      );
      return { outcome: "pull_request_merged" as const, number: value.number };
    }
    if (result.queued) {
      await respond(
        deps,
        payload.response_url,
        `Pull request #${value.number} is queued to merge when repository checks pass.`
      );
      return { outcome: "pull_request_queued" as const, number: value.number };
    }
    await respond(
      deps,
      payload.response_url,
      `Pull request #${value.number} was not merged. Refresh its status and review the repository checks.`
    );
    return { outcome: "ignored" as const, reason: "merge_blocked" };
  };
}

type SlackViewSubmissionPayload = SlackBlockActionsPayload & {
  view?: {
    callback_id?: string;
    private_metadata?: string;
    state?: {
      values?: Record<
        string,
        Record<string, { value?: string | null } | undefined>
      >;
    };
  };
};

function readModalValue(
  payload: SlackViewSubmissionPayload,
  blockId: string,
  actionId: string
) {
  return (
    payload.view?.state?.values?.[blockId]?.[actionId]?.value?.trim() ?? ""
  );
}

function readIssueMetadata(payload: SlackViewSubmissionPayload) {
  try {
    const value = JSON.parse(payload.view?.private_metadata ?? "") as Record<
      string,
      unknown
    >;
    return typeof value.repoId === "string" &&
      typeof value.channelId === "string"
      ? { repoId: value.repoId, channelId: value.channelId }
      : null;
  } catch {
    return null;
  }
}

async function notifyIssueSubmission(input: {
  deps: SlackCommandInteractionDeps;
  teamId: string;
  channelId: string;
  slackUserId: string;
  text: string;
}) {
  try {
    const botToken = await input.deps.getBotToken(input.teamId);
    if (!botToken) return;
    await input.deps.postEphemeral(botToken, {
      channel: input.channelId,
      user: input.slackUserId,
      text: input.text,
    });
  } catch (error) {
    console.warn("[slack-command] issue result notification failed", error);
  }
}

export function createSlackIssueModalSubmissionHandler(
  overrides: Partial<SlackCommandInteractionDeps> = {}
) {
  const deps = { ...defaultDeps, ...overrides };
  return async function handleSlackIssueModalSubmission(
    payload: SlackViewSubmissionPayload
  ) {
    if (
      payload.type !== "view_submission" ||
      payload.view?.callback_id !== SLACK_ISSUE_MODAL_CALLBACK_ID
    ) {
      return { outcome: "ignored" as const, reason: "unknown_view" };
    }
    const teamId = payload.team?.id;
    const slackUserId = payload.user?.id;
    const metadata = readIssueMetadata(payload);
    const title = readModalValue(
      payload,
      SLACK_ISSUE_TITLE_BLOCK_ID,
      SLACK_ISSUE_TITLE_ACTION_ID
    );
    const body = readModalValue(
      payload,
      SLACK_ISSUE_BODY_BLOCK_ID,
      SLACK_ISSUE_BODY_ACTION_ID
    );
    if (!teamId || !slackUserId || !metadata || !title) {
      return {
        outcome: "ignored" as const,
        reason: "invalid_issue_submission",
      };
    }
    const actor = await resolveActor({ deps, teamId, slackUserId });
    if (!actor) {
      await notifyIssueSubmission({
        deps,
        teamId,
        channelId: metadata.channelId,
        slackUserId,
        text: "Link your Slack identity to your Mogplex account, then try again.",
      });
      return { outcome: "not_linked" as const };
    }
    const link = await deps.getChannelLink({
      installationId: actor.installation.id,
      channelId: metadata.channelId,
    });
    if (link?.repo_id !== metadata.repoId) {
      await notifyIssueSubmission({
        deps,
        teamId,
        channelId: metadata.channelId,
        slackUserId,
        text: "The channel repository changed. Run `/mogplex issues` and try again.",
      });
      return { outcome: "ignored" as const, reason: "stale_repo" };
    }
    const repos = await deps.listRepos(actor.mogplexUserId, {
      id: metadata.repoId,
      limit: 1,
    });
    const repo = repos[0];
    if (!repo) {
      await notifyIssueSubmission({
        deps,
        teamId,
        channelId: metadata.channelId,
        slackUserId,
        text: "That repository is no longer available to your Mogplex account.",
      });
      return { outcome: "ignored" as const, reason: "repo_unavailable" };
    }
    let created: Awaited<ReturnType<typeof createSlackRepoIssue>>;
    try {
      created = await deps.createIssue({
        userId: actor.mogplexUserId,
        repo,
        title,
        body,
      });
    } catch (error) {
      console.error("[slack-command] issue creation failed", {
        repoId: repo.id,
        error,
      });
      await notifyIssueSubmission({
        deps,
        teamId,
        channelId: metadata.channelId,
        slackUserId,
        text: "Mogplex could not create that issue right now. Try again shortly.",
      });
      return { outcome: "ignored" as const, reason: "issue_create_failed" };
    }
    const issueLabel = `Issue #${created.issueNumber}`;
    await notifyIssueSubmission({
      deps,
      teamId,
      channelId: metadata.channelId,
      slackUserId,
      text: created.issueUrl
        ? `${issueLabel} created: ${created.issueUrl}`
        : `${issueLabel} created in ${repo.full_name}.`,
    });
    return {
      outcome: "issue_created" as const,
      issueNumber: created.issueNumber,
    };
  };
}

export const handleSlackPullRequestMergeAction =
  createSlackPullRequestMergeActionHandler();
export const handleSlackIssueModalSubmission =
  createSlackIssueModalSubmissionHandler();

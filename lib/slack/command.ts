import { buildAppUrl } from "@/lib/app-url";
import { listMogplexApiRunEvents } from "@/lib/mogplex-api/run-control";
import {
  listMogplexApiRepos,
  type MogplexApiRepo,
} from "@/lib/mogplex-api/repos";
import {
  listUsableModelIdsForScope,
  resolveStoredUserDefaultModelId,
} from "@/lib/models/default-model";
import {
  buildSlackCommandHubBlocks,
  buildSlackIssueBlocks,
  buildSlackIssueModal,
  buildSlackPullRequestBlocks,
  buildSlackRepoBlocks,
  buildSlackStatusBlocks,
  buildSlackUsageBlocks,
} from "@/lib/slack/command-blocks";
import {
  listSlackRepoIssues,
  listSlackRepoPullRequests,
  loadLatestSlackRun,
  loadSlackUsageSummary,
} from "@/lib/slack/command-data";
import { getSlackBotToken, openSlackView } from "@/lib/slack/client";
import {
  getSlackChannelLink,
  setSlackChannelLink,
} from "@/lib/slack/channel-links";
import {
  getSlackInstallationByTeamId,
  getSlackUserMapping,
  isExplicitSlackUserMapping,
  type SlackInstallationRow,
  type SlackUserMappingRow,
} from "@/lib/slack/installations";
import { handleSlackModelCommand } from "@/lib/slack/model-command";
import { getSlackModelPreference } from "@/lib/slack/model-preferences";
import { postSlackResponse } from "@/lib/slack/response";

export type SlackCommandPayload = {
  command: string;
  text: string;
  teamId: string;
  channelId: string;
  slackUserId: string;
  responseUrl: string;
  triggerId?: string;
};

type SlackCommandDeps = {
  getInstallation: typeof getSlackInstallationByTeamId;
  getUserMapping: typeof getSlackUserMapping;
  getChannelLink: typeof getSlackChannelLink;
  setChannelLink: typeof setSlackChannelLink;
  listRepos: typeof listMogplexApiRepos;
  loadLatestRun: typeof loadLatestSlackRun;
  listRunEvents: typeof listMogplexApiRunEvents;
  listUsableModels: typeof listUsableModelIdsForScope;
  resolveDefaultModel: typeof resolveStoredUserDefaultModelId;
  getModelPreference: typeof getSlackModelPreference;
  loadUsage: typeof loadSlackUsageSummary;
  listPullRequests: typeof listSlackRepoPullRequests;
  listIssues: typeof listSlackRepoIssues;
  getBotToken: typeof getSlackBotToken;
  openView: typeof openSlackView;
  postResponse: typeof postSlackResponse;
  handleModelCommand: typeof handleSlackModelCommand;
};

type SlackCommandUser = {
  installation: SlackInstallationRow;
  mogplexUserId: string;
  canChangeChannelRepo: boolean;
};

const defaultDeps: SlackCommandDeps = {
  getInstallation: getSlackInstallationByTeamId,
  getUserMapping: getSlackUserMapping,
  getChannelLink: getSlackChannelLink,
  setChannelLink: setSlackChannelLink,
  listRepos: listMogplexApiRepos,
  loadLatestRun: loadLatestSlackRun,
  listRunEvents: listMogplexApiRunEvents,
  listUsableModels: listUsableModelIdsForScope,
  resolveDefaultModel: resolveStoredUserDefaultModelId,
  getModelPreference: getSlackModelPreference,
  loadUsage: loadSlackUsageSummary,
  listPullRequests: listSlackRepoPullRequests,
  listIssues: listSlackRepoIssues,
  getBotToken: getSlackBotToken,
  openView: openSlackView,
  postResponse: postSlackResponse,
  handleModelCommand: handleSlackModelCommand,
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

async function resolveCommandUser(
  deps: SlackCommandDeps,
  payload: SlackCommandPayload
): Promise<SlackCommandUser | string> {
  const installation = await deps.getInstallation(payload.teamId);
  if (!installation) return "Connect this Slack workspace to Mogplex first.";
  const mapping = await deps.getUserMapping({
    installationId: installation.id,
    slackUserId: payload.slackUserId,
  });
  const mogplexUserId = resolveMogplexUserId(
    installation,
    mapping,
    payload.slackUserId
  );
  if (!mogplexUserId) {
    return "Link your Slack identity to your Mogplex account, then try again.";
  }
  return {
    installation,
    mogplexUserId,
    canChangeChannelRepo:
      installation.installed_by_user_id === mogplexUserId &&
      installation.authed_user_slack_id === payload.slackUserId,
  };
}

async function respond(
  deps: SlackCommandDeps,
  payload: SlackCommandPayload,
  text: string,
  blocks?: Array<Record<string, unknown>>
) {
  await deps.postResponse(payload.responseUrl, {
    response_type: "ephemeral",
    replace_original: false,
    text,
    ...(blocks ? { blocks } : {}),
  });
}

type ParsedCommand = { name: string; argument: string };

function parseCommand(payload: SlackCommandPayload): ParsedCommand | null {
  const command = payload.command.trim().toLowerCase();
  if (command === "/model") {
    return { name: "model", argument: payload.text.trim() };
  }
  if (command !== "/mogplex") return null;
  const [rawName = "help", ...rest] = payload.text
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const name = rawName.toLowerCase();
  const aliases: Record<string, string> = {
    issue: "issues",
    pr: "prs",
    repository: "repo",
    runs: "status",
  };
  return { name: aliases[name] ?? name, argument: rest.join(" ") };
}

async function loadRepoContext(input: {
  deps: SlackCommandDeps;
  payload: SlackCommandPayload;
  user: SlackCommandUser;
}) {
  const link = await input.deps.getChannelLink({
    installationId: input.user.installation.id,
    channelId: input.payload.channelId,
  });
  if (!link) return { link: null, repo: null };
  const repos = await input.deps.listRepos(input.user.mogplexUserId, {
    id: link.repo_id,
    limit: 1,
  });
  return { link, repo: repos[0] ?? null };
}

async function effectiveModel(
  deps: SlackCommandDeps,
  payload: SlackCommandPayload,
  user: SlackCommandUser
) {
  const [models, selected, fallback] = await Promise.all([
    deps.listUsableModels(user.mogplexUserId),
    deps.getModelPreference({
      installationId: user.installation.id,
      channelId: payload.channelId,
      slackUserId: payload.slackUserId,
    }),
    deps.resolveDefaultModel(user.mogplexUserId),
  ]);
  if (selected?.model_id && models.includes(selected.model_id)) {
    return selected.model_id;
  }
  return fallback && models.includes(fallback) ? fallback : null;
}

async function handleRepoCommand(input: {
  deps: SlackCommandDeps;
  payload: SlackCommandPayload;
  user: SlackCommandUser;
  argument: string;
}) {
  const { deps, payload, user, argument } = input;
  const repos = await deps.listRepos(user.mogplexUserId, { limit: 100 });
  if (argument) {
    if (!user.canChangeChannelRepo) {
      await respond(
        deps,
        payload,
        "Only the Slack app installer can change this channel's repository."
      );
      return;
    }
    const normalized = argument.toLowerCase();
    const selected = repos.find(
      (repo) =>
        repo.id === argument || repo.full_name.toLowerCase() === normalized
    );
    if (!selected) {
      await respond(
        deps,
        payload,
        "That repository is not available to your Mogplex account. Run `/mogplex repo` to refresh the choices."
      );
      return;
    }
    await deps.setChannelLink({
      installationId: user.installation.id,
      channelId: payload.channelId,
      channelName: null,
      repoId: selected.id,
      createdByUserId: user.mogplexUserId,
    });
    await respond(
      deps,
      payload,
      `Channel repository set to ${selected.full_name}.`
    );
    return;
  }

  const { link, repo } = await loadRepoContext({ deps, payload, user });
  await respond(
    deps,
    payload,
    repo
      ? `Channel repository: ${repo.full_name}`
      : "This channel is not linked to a repository.",
    buildSlackRepoBlocks({
      currentRepoId: link?.repo_id ?? null,
      currentRepoName: repo?.full_name ?? null,
      repos,
      canChange: user.canChangeChannelRepo,
    })
  );
}

async function requireLinkedRepo(input: {
  deps: SlackCommandDeps;
  payload: SlackCommandPayload;
  user: SlackCommandUser;
}): Promise<MogplexApiRepo | null> {
  const { repo } = await loadRepoContext(input);
  if (repo) return repo;
  await respond(
    input.deps,
    input.payload,
    "Link this channel to a repository with `/mogplex repo` first."
  );
  return null;
}

async function handleStatusCommand(input: {
  deps: SlackCommandDeps;
  payload: SlackCommandPayload;
  user: SlackCommandUser;
}) {
  const { deps, payload, user } = input;
  const [run, model] = await Promise.all([
    deps.loadLatestRun({
      userId: user.mogplexUserId,
      teamId: payload.teamId,
      slackUserId: payload.slackUserId,
    }),
    effectiveModel(deps, payload, user),
  ]);
  const eventPage = run
    ? await deps.listRunEvents({
        userId: user.mogplexUserId,
        runId: run.id,
        limit: 1,
      })
    : null;
  const event = eventPage?.events.at(-1);
  const progress = event?.message ?? event?.toolName ?? null;
  const runUrl = run ? buildAppUrl(`/runs/${run.id}`).toString() : undefined;
  await respond(
    deps,
    payload,
    run ? `Latest run is ${run.status}.` : "No Slack-started runs yet.",
    buildSlackStatusBlocks({ run, runUrl, progress, model })
  );
}

async function handlePullRequestsCommand(input: {
  deps: SlackCommandDeps;
  payload: SlackCommandPayload;
  user: SlackCommandUser;
}) {
  const repo = await requireLinkedRepo(input);
  if (!repo) return;
  const list = await input.deps.listPullRequests({
    userId: input.user.mogplexUserId,
    repo,
  });
  await respond(
    input.deps,
    input.payload,
    `${list.totalCount} open pull request${list.totalCount === 1 ? "" : "s"} in ${repo.full_name}.`,
    buildSlackPullRequestBlocks({ repo, list })
  );
}

async function handleIssuesCommand(input: {
  deps: SlackCommandDeps;
  payload: SlackCommandPayload;
  user: SlackCommandUser;
  argument: string;
}) {
  const repo = await requireLinkedRepo(input);
  if (!repo) return;
  if (input.argument === "create") {
    if (!input.payload.triggerId) {
      await respond(
        input.deps,
        input.payload,
        "Slack did not provide a valid interaction trigger. Run `/mogplex issues create` again."
      );
      return;
    }
    const botToken = await input.deps.getBotToken(input.payload.teamId);
    if (!botToken) throw new Error("Slack bot token unavailable");
    await input.deps.openView(botToken, {
      trigger_id: input.payload.triggerId,
      view: buildSlackIssueModal({
        repo,
        channelId: input.payload.channelId,
      }),
    });
    return;
  }
  const list = await input.deps.listIssues({
    userId: input.user.mogplexUserId,
    repo,
  });
  await respond(
    input.deps,
    input.payload,
    `${list.totalCount} open issue${list.totalCount === 1 ? "" : "s"} in ${repo.full_name}.`,
    buildSlackIssueBlocks({ repo, list })
  );
}

async function handleAuthorizedCommand(input: {
  deps: SlackCommandDeps;
  payload: SlackCommandPayload;
  user: SlackCommandUser;
  command: ParsedCommand;
}) {
  const { deps, payload, user, command } = input;
  switch (command.name) {
    case "help":
      await respond(
        deps,
        payload,
        "Mogplex commands: status, repo, prs, issues, usage, and model.",
        buildSlackCommandHubBlocks()
      );
      return;
    case "status":
      await handleStatusCommand({ deps, payload, user });
      return;
    case "repo":
      await handleRepoCommand({
        deps,
        payload,
        user,
        argument: command.argument,
      });
      return;
    case "prs":
      await handlePullRequestsCommand({ deps, payload, user });
      return;
    case "issues":
      await handleIssuesCommand({
        deps,
        payload,
        user,
        argument: command.argument,
      });
      return;
    case "usage": {
      const summary = await deps.loadUsage(user.mogplexUserId);
      await respond(
        deps,
        payload,
        `Spendable inference credit: $${(summary.totalCents / 100).toFixed(2)}.`,
        buildSlackUsageBlocks(summary)
      );
      return;
    }
    default:
      await respond(
        deps,
        payload,
        `Unknown subcommand: ${command.name}. Use \`/mogplex help\` to see available commands.`,
        buildSlackCommandHubBlocks()
      );
  }
}

export function createSlackCommandHandler(
  overrides: Partial<SlackCommandDeps> = {}
) {
  const deps = { ...defaultDeps, ...overrides };
  return async function handleSlackCommand(
    payload: SlackCommandPayload
  ): Promise<void> {
    const command = parseCommand(payload);
    if (!command) {
      await respond(
        deps,
        payload,
        "Use `/mogplex help` to see available commands."
      );
      return;
    }
    if (command.name === "model") {
      await deps.handleModelCommand({
        ...payload,
        text:
          payload.command.trim().toLowerCase() === "/model"
            ? command.argument
            : `model ${command.argument}`.trim(),
      });
      return;
    }
    try {
      const user = await resolveCommandUser(deps, payload);
      if (typeof user === "string") {
        await respond(deps, payload, user);
        return;
      }
      await handleAuthorizedCommand({ deps, payload, user, command });
    } catch (error) {
      console.error("[slack-command] command failed", {
        command: command.name,
        error,
      });
      await respond(
        deps,
        payload,
        "Mogplex could not complete that command right now. Try again shortly."
      ).catch(() => undefined);
    }
  };
}

export const handleSlackCommand = createSlackCommandHandler();

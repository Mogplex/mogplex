import { buildBuiltinCommands } from "@/lib/slash-commands";
import {
  listUsableModelIdsForScope,
  resolveStoredUserDefaultModelId,
} from "@/lib/models/default-model";
import {
  getSlackInstallationByTeamId,
  getSlackUserMapping,
  isExplicitSlackUserMapping,
  type SlackInstallationRow,
  type SlackUserMappingRow,
} from "@/lib/slack/installations";
import {
  getSlackModelPreference,
  upsertSlackModelPreference,
} from "@/lib/slack/model-preferences";
import { postSlackResponse } from "@/lib/slack/interactivity";

export type SlackModelCommandPayload = {
  command: string;
  text: string;
  teamId: string;
  channelId: string;
  slackUserId: string;
  responseUrl: string;
};

type SlackModelCommandDeps = {
  getInstallation: typeof getSlackInstallationByTeamId;
  getUserMapping: typeof getSlackUserMapping;
  listUsableModels: typeof listUsableModelIdsForScope;
  resolveDefaultModel: typeof resolveStoredUserDefaultModelId;
  getPreference: typeof getSlackModelPreference;
  savePreference: typeof upsertSlackModelPreference;
  postResponse: typeof postSlackResponse;
};

type SlackModelCommandUser = {
  installation: SlackInstallationRow;
  mogplexUserId: string;
};

const defaultDeps: SlackModelCommandDeps = {
  getInstallation: getSlackInstallationByTeamId,
  getUserMapping: getSlackUserMapping,
  listUsableModels: listUsableModelIdsForScope,
  resolveDefaultModel: resolveStoredUserDefaultModelId,
  getPreference: getSlackModelPreference,
  savePreference: upsertSlackModelPreference,
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

function readModelArgument(payload: SlackModelCommandPayload) {
  if (!["/mogplex", "/model"].includes(payload.command.toLowerCase())) {
    return null;
  }
  const words = payload.text.trim().split(/\s+/).filter(Boolean);
  if (payload.command === "/model") return words.join(" ");
  if (words[0]?.toLowerCase() !== "model") return null;
  return words.slice(1).join(" ");
}

async function resolveCommandUser(
  deps: SlackModelCommandDeps,
  payload: SlackModelCommandPayload
): Promise<SlackModelCommandUser | string> {
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
  return mogplexUserId
    ? { installation, mogplexUserId }
    : "Link your Slack identity to your Mogplex account, then try again.";
}

function listText(input: {
  selected: string | null;
  fallback: string | null;
  models: string[];
}) {
  const selected =
    input.selected && input.models.includes(input.selected)
      ? input.selected
      : null;
  const current = selected ?? input.fallback ?? "No usable model";
  const source = selected
    ? "selected for you in this channel"
    : input.selected
      ? `default; saved selection ${input.selected} is unavailable`
      : "default";
  return [
    `Current model: ${current} (${source})`,
    "",
    `Available models: ${input.models.join(", ") || "None"}`,
    "",
    "Change it with `/mogplex model <model-id>`.",
  ].join("\n");
}

async function respond(
  deps: SlackModelCommandDeps,
  payload: SlackModelCommandPayload,
  text: string
) {
  await deps.postResponse(payload.responseUrl, {
    response_type: "ephemeral",
    replace_original: false,
    text,
  });
}

function readSelectedModel(
  result:
    | {
        action?: string;
        payload?: unknown;
      }
    | null
    | undefined
) {
  return result?.action === "set_model" && typeof result.payload === "string"
    ? result.payload
    : null;
}

async function handleAuthorizedModelCommand(input: {
  deps: SlackModelCommandDeps;
  payload: SlackModelCommandPayload;
  user: SlackModelCommandUser;
  modelArgument: string;
}) {
  const { deps, payload, user, modelArgument } = input;
  const [models, preference, fallback] = await Promise.all([
    deps.listUsableModels(user.mogplexUserId),
    deps.getPreference({
      installationId: user.installation.id,
      channelId: payload.channelId,
      slackUserId: payload.slackUserId,
    }),
    deps.resolveDefaultModel(user.mogplexUserId),
  ]);
  if (!modelArgument) {
    await respond(
      deps,
      payload,
      listText({ selected: preference?.model_id ?? null, fallback, models })
    );
    return;
  }

  const modelCommand = buildBuiltinCommands({ models }).find(
    (command) => command.name === "model"
  );
  const result = modelCommand?.execute(modelArgument);
  const selectedModel = readSelectedModel(result);
  if (!selectedModel) {
    await respond(
      deps,
      payload,
      `${result?.output ?? `Unknown model: ${modelArgument}`}\nUse \`/mogplex model\` to list models available to your account.`
    );
    return;
  }

  await deps.savePreference({
    installationId: user.installation.id,
    channelId: payload.channelId,
    slackUserId: payload.slackUserId,
    modelId: selectedModel,
  });
  await respond(
    deps,
    payload,
    `Model set to ${selectedModel} for you in this channel. It will apply to your next eligible Mogplex response.`
  );
}

export function createSlackModelCommandHandler(
  overrides: Partial<SlackModelCommandDeps> = {}
) {
  const deps = { ...defaultDeps, ...overrides };
  return async function handleSlackModelCommand(
    payload: SlackModelCommandPayload
  ): Promise<void> {
    try {
      const modelArgument = readModelArgument(payload);
      if (modelArgument === null) {
        await respond(
          deps,
          payload,
          "Usage: `/mogplex model` or `/mogplex model <model-id>`."
        );
        return;
      }

      const user = await resolveCommandUser(deps, payload);
      if (typeof user === "string") {
        await respond(deps, payload, user);
        return;
      }
      await handleAuthorizedModelCommand({
        deps,
        payload,
        user,
        modelArgument,
      });
    } catch (error) {
      console.error("[slack-model-command] command failed", error);
      await respond(
        deps,
        payload,
        "Mogplex could not update your model right now. Try again shortly."
      ).catch(() => undefined);
    }
  };
}

export const handleSlackModelCommand = createSlackModelCommandHandler();

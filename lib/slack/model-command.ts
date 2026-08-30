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
import { SLACK_MODEL_SELECT_ACTION_ID } from "@/lib/slack/command-actions";
import { postSlackResponse } from "@/lib/slack/response";

export type SlackModelCommandPayload = {
  command: string;
  text: string;
  teamId: string;
  channelId: string;
  slackUserId: string;
  responseUrl: string;
  triggerId?: string;
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
  const command = payload.command.trim().toLowerCase();
  if (!["/mogplex", "/model"].includes(command)) {
    return null;
  }
  const words = payload.text.trim().split(/\s+/).filter(Boolean);
  if (command === "/model") return words.join(" ");
  if (words.length === 0) return "";
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

function effectiveModel(input: {
  selected: string | null;
  fallback: string | null;
  models: string[];
}) {
  return input.selected && input.models.includes(input.selected)
    ? input.selected
    : input.fallback && input.models.includes(input.fallback)
      ? input.fallback
      : null;
}

function buildModelPickerBlocks(input: {
  selected: string | null;
  fallback: string | null;
  models: string[];
}) {
  if (input.models.length === 0) return undefined;

  const current = effectiveModel(input);
  const visibleModels = input.models.slice(0, 100);
  if (current && !visibleModels.includes(current)) {
    visibleModels[visibleModels.length - 1] = current;
  }
  const options = visibleModels.map((modelId) => ({
    text: { type: "plain_text", text: modelId.slice(0, 75), emoji: true },
    value: modelId,
  }));
  const initialOption = current
    ? options.find((option) => option.value === current)
    : undefined;

  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: current
          ? `*Current model:* \`${current}\``
          : "*Current model:* No usable model",
      },
    },
    {
      type: "actions",
      block_id: "mogplex_model_picker",
      elements: [
        {
          type: "static_select",
          action_id: SLACK_MODEL_SELECT_ACTION_ID,
          placeholder: { type: "plain_text", text: "Choose a model" },
          options,
          ...(initialOption ? { initial_option: initialOption } : {}),
        },
      ],
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "Or use `/mogplex model <model-id>`.",
        },
      ],
    },
  ];
}

async function respond(
  deps: SlackModelCommandDeps,
  payload: SlackModelCommandPayload,
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
    const pickerInput = {
      selected: preference?.model_id ?? null,
      fallback,
      models,
    };
    await respond(
      deps,
      payload,
      listText(pickerInput),
      buildModelPickerBlocks(pickerInput)
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

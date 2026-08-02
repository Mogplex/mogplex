import crypto from "node:crypto";
import { metadata, task } from "@trigger.dev/sdk/v3";
import { TRIGGER_TASK_IDS } from "@/lib/trigger/task-ids";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  bindSlackThreadToConversation,
  findProfileIdByEmail,
  getSlackChannelLink,
  getSlackInstallationByTeamId,
  getSlackThreadConversation,
  getSlackUserMapping,
  isExplicitSlackUserMapping,
  SlackThreadConversationAlreadyBoundError,
  createSlackUserLinkToken,
  upsertSlackUserMapping,
  type SlackChannelLinkRow,
  type SlackInstallationRow,
} from "@/lib/slack/installations";
import {
  getSlackBotToken,
  postSlackEphemeral,
  getSlackUserInfo,
  postSlackMessage,
  stripSlackMention,
  updateSlackMessage,
} from "@/lib/slack/client";
import {
  buildCancelRunActionsBlock,
  buildRepoAgentRunStartedText,
  SLACK_RUN_CONTROLS_METADATA_KEY,
} from "@/lib/slack/run-controls";
import {
  runChatAgent,
  type RunChatAgentContentPart,
  type RunChatAgentMessage,
} from "@/lib/agents/run-chat";
import { windowMessages } from "@/lib/agents/message-window";
import { startMogplexApiRun } from "@/lib/mogplex-api/runs";
import { buildAppUrl } from "@/lib/app-url";
import {
  SLACK_IMAGE_ATTACHMENT_FETCH_TIMEOUT_MS,
  SLACK_IMAGE_ATTACHMENT_MAX_BYTES,
  SLACK_IMAGE_ATTACHMENT_MAX_COUNT,
  SLACK_RUN_IMAGE_ATTACHMENTS_METADATA_KEY,
  type SlackRunImageAttachment,
} from "@/lib/slack/run-attachments";
import { dispatchSlackMentionWorkflows } from "@/lib/flows/trigger-dispatch";

export const SLACK_EVENT_TASK_MAX_DURATION_SECONDS = 60 * 15;

/** Slack rate-limits chat.update at roughly 1/sec/channel. */
const SLACK_UPDATE_MIN_INTERVAL_MS = 1_000;

/** A blank/empty Slack message is rejected — always send something. */
const PLACEHOLDER_TEXT = "_Thinking…_";

export {
  SLACK_IMAGE_ATTACHMENT_FETCH_TIMEOUT_MS,
  SLACK_IMAGE_ATTACHMENT_MAX_BYTES,
  SLACK_IMAGE_ATTACHMENT_MAX_COUNT,
} from "@/lib/slack/run-attachments";

export type SlackEventAttachment = SlackRunImageAttachment;

export type SlackEventAttachmentNotice = {
  reason: "count_cap";
  count: number;
};

export type SlackEventTaskPayload = {
  teamId: string;
  eventId: string;
  channelId: string;
  threadTs: string;
  messageTs: string;
  slackUserId: string;
  text: string;
  channelType: "im" | "mpim" | "channel" | "group";
  eventType: "app_mention" | "message";
  attachments?: SlackEventAttachment[];
  attachmentNotices?: SlackEventAttachmentNotice[];
  attachmentDroppedCount?: number;
};

export function buildSlackToolExecutionIdempotencyKey(
  payload: Pick<SlackEventTaskPayload, "teamId" | "eventId">
): string | null {
  const teamId =
    typeof payload.teamId === "string" ? payload.teamId.trim() : "";
  const eventId =
    typeof payload.eventId === "string" ? payload.eventId.trim() : "";
  return teamId && eventId ? `slack:${teamId}:${eventId}` : null;
}

export type SlackEventTaskResult = {
  outcome:
    | "unknown_workspace"
    | "ignored_self_message"
    | "ignored_no_mogplex_user"
    | "repo_agent_disabled"
    | "repo_agent_user_not_allowed"
    | "repo_agent_monthly_limit_reached"
    | "conversational_reply"
    | "repo_agent_run_started"
    | "workflow_runs_started"
    | "workflow_mention_handled"
    | "ignored_unbound_thread_message"
    | "ignored_uninvoked_group_message"
    | "skipped_empty_text";
  conversationId?: string;
  mogplexUserId?: string | null;
  runId?: string;
  runIds?: string[];
  attachments_attached?: number;
  attachments_dropped?: number;
};

type ConversationRow = {
  id: string;
  user_id: string;
  messages: RunChatAgentMessage[];
  model: string | null;
  title: string | null;
  updated_at?: string | null;
};

type SlackPostedMessageRef = {
  channel: string;
  ts: string;
  threadTs: string;
  eventId: string;
};

type SlackAttributionMode =
  | "mapped_profile"
  | "legacy_email"
  | "installer_fallback"
  | "unmapped";

export type SlackAttribution = {
  mode: SlackAttributionMode;
  mogplexUserId: string | null;
  slackEmail: string | null;
  githubUsername?: string | null;
};

export type SlackRepoAgentRunContext = {
  mode: "repo_agent";
  teamId: string;
  installationId: string;
  channelId: string;
  slackUserId: string;
  slackEmail: string | null;
  attributionMode: SlackAttributionMode;
};

export type StartRepoAgentRunInput = {
  mogplexUserId: string;
  repoId: string;
  prompt: string;
  idempotencyKey: string;
  slackContext: SlackRepoAgentRunContext;
  slackAttachments?: SlackRunImageAttachment[];
  slackAttachmentDroppedCount?: number;
  /**
   * The Slack message the "Cancel run" button is attached to. Persisted on the
   * run so a completion hook can `chat.update` it (strip the button, update the
   * text) once the run reaches a terminal state — see issue #398.
   */
  slackMessage?: { teamId: string; channelId: string; messageTs: string };
};

export type StartRepoAgentRunResult = {
  runId: string;
};

export type SlackEventTaskDeps = {
  getInstallation: (teamId: string) => Promise<SlackInstallationRow | null>;
  getBotToken: (teamId: string) => Promise<string | null>;
  resolveSlackAttribution: (
    installation: SlackInstallationRow,
    slackUserId: string,
    botToken: string
  ) => Promise<SlackAttribution>;
  getChannelLink: (input: {
    installationId: string;
    channelId: string;
  }) => Promise<SlackChannelLinkRow | null>;
  reserveSlackRepoAgentMonthlyRun: (input: {
    installationId: string;
    teamId: string;
    eventId: string;
    monthStartDate: string;
    monthlyLimit: number;
  }) => Promise<boolean>;
  releaseSlackRepoAgentMonthlyRun: (input: {
    teamId: string;
    eventId: string;
    monthStartDate: string;
  }) => Promise<void>;
  now: () => Date;
  loadBoundConversation: (input: {
    installationId: string;
    channelId: string;
    threadTs: string;
  }) => Promise<ConversationRow | null>;
  loadOrCreateConversation: (input: {
    installation: SlackInstallationRow;
    channelId: string;
    threadTs: string;
    mogplexUserId: string;
    requireExisting?: boolean;
  }) => Promise<ConversationRow | null>;
  persistConversation: (input: {
    conversationId: string;
    userId: string;
    messages: RunChatAgentMessage[];
    expectedUpdatedAt?: string | null;
  }) => Promise<void>;
  runAgent: typeof runChatAgent;
  fetchAttachment: (input: {
    botToken: string;
    url: string;
    signal: AbortSignal;
  }) => Promise<Response>;
  startRepoAgentRun: (
    input: StartRepoAgentRunInput
  ) => Promise<StartRepoAgentRunResult>;
  buildRunUrl: (runId: string) => string;
  postMessage: typeof postSlackMessage;
  postEphemeral: typeof postSlackEphemeral;
  updateMessage: typeof updateSlackMessage;
  createUserLinkToken: (input: {
    installationId: string;
    teamId: string;
    slackUserId: string;
  }) => Promise<{ token: string; expiresAt: string } | null>;
  buildSlackLinkUrl: (token: string) => string;
};

async function defaultStartRepoAgentRun(
  input: StartRepoAgentRunInput
): Promise<StartRepoAgentRunResult> {
  const extraMetadata: Record<string, unknown> = {
    slack: input.slackContext,
    slack_team_id: input.slackContext.teamId,
    slack_installation_id: input.slackContext.installationId,
    slack_mode: input.slackContext.mode,
    slack_user_id: input.slackContext.slackUserId,
    slack_attribution_mode: input.slackContext.attributionMode,
  };
  if (input.slackMessage) {
    extraMetadata[SLACK_RUN_CONTROLS_METADATA_KEY] = input.slackMessage;
  }
  if (input.slackAttachments?.length) {
    extraMetadata[SLACK_RUN_IMAGE_ATTACHMENTS_METADATA_KEY] = {
      teamId: input.slackContext.teamId,
      files: input.slackAttachments,
      ...(input.slackAttachmentDroppedCount
        ? { droppedCount: input.slackAttachmentDroppedCount }
        : {}),
    };
  }

  const result = await startMogplexApiRun({
    user: {
      userId: input.mogplexUserId,
      keyId: "slack-bot",
      scopes: ["runs:write"],
    },
    idempotencyKey: input.idempotencyKey,
    body: {
      repoId: input.repoId,
      prompt: input.prompt,
      harness: "claude-code",
    },
    extraMetadata,
  });
  return { runId: result.run.runId };
}

function defaultBuildRunUrl(runId: string): string {
  return buildAppUrl(`/runs/${runId}`).toString();
}

const defaultDeps: SlackEventTaskDeps = {
  getInstallation: (teamId) => getSlackInstallationByTeamId(teamId),
  getBotToken: (teamId) => getSlackBotToken(teamId),
  resolveSlackAttribution: defaultResolveSlackAttribution,
  getChannelLink: getSlackChannelLink,
  reserveSlackRepoAgentMonthlyRun: defaultReserveSlackRepoAgentMonthlyRun,
  releaseSlackRepoAgentMonthlyRun: defaultReleaseSlackRepoAgentMonthlyRun,
  now: () => new Date(),
  loadBoundConversation,
  loadOrCreateConversation: defaultLoadOrCreateConversation,
  persistConversation: defaultPersistConversation,
  runAgent: runChatAgent,
  fetchAttachment: ({ botToken, url, signal }) =>
    fetch(url, {
      headers: { Authorization: `Bearer ${botToken}` },
      redirect: "error",
      signal,
    }),
  startRepoAgentRun: defaultStartRepoAgentRun,
  buildRunUrl: defaultBuildRunUrl,
  postMessage: postSlackMessage,
  postEphemeral: postSlackEphemeral,
  updateMessage: updateSlackMessage,
  createUserLinkToken: createSlackUserLinkToken,
  buildSlackLinkUrl: (token) =>
    buildAppUrl(`/slack/link?token=${encodeURIComponent(token)}`).toString(),
};

export class SlackConversationPersistConflictError extends Error {
  constructor(readonly conversation: ConversationRow) {
    super("Conversation changed before Slack thread history could be saved");
    this.name = "SlackConversationPersistConflictError";
  }
}

function resolveKnownSlackAttribution(input: {
  installation: SlackInstallationRow;
  slackUserId: string;
  existing: Awaited<ReturnType<typeof getSlackUserMapping>>;
}): SlackAttribution | null {
  if (isExplicitSlackUserMapping(input.existing)) {
    return {
      mode: "mapped_profile",
      mogplexUserId: input.existing.mogplex_user_id,
      slackEmail: input.existing.slack_email,
    };
  }

  if (
    input.installation.authed_user_slack_id &&
    input.slackUserId === input.installation.authed_user_slack_id
  ) {
    return {
      mode: "installer_fallback",
      mogplexUserId: input.installation.installed_by_user_id,
      slackEmail: input.existing?.slack_email ?? null,
    };
  }

  return null;
}

async function defaultResolveSlackAttribution(
  installation: SlackInstallationRow,
  slackUserId: string,
  botToken: string
): Promise<SlackAttribution> {
  const existing = await getSlackUserMapping({
    installationId: installation.id,
    slackUserId,
  });
  const knownAttribution = resolveKnownSlackAttribution({
    installation,
    slackUserId,
    existing,
  });
  if (knownAttribution) {
    return {
      ...knownAttribution,
      githubUsername: await findProfileGithubUsername(
        knownAttribution.mogplexUserId
      ),
    };
  }

  // Try to look up the Slack user's email and match it to a Mogplex profile.
  let slackEmail: string | null = existing?.slack_email ?? null;
  try {
    const userInfo = await getSlackUserInfo(botToken, slackUserId);
    slackEmail = userInfo.profile?.email ?? null;
  } catch (error) {
    console.warn("[slack-event] users.info lookup failed", error);
  }

  let matchedProfileId: string | null = null;
  if (slackEmail) {
    matchedProfileId = await findProfileIdByEmail(slackEmail);
  }

  await upsertSlackUserMapping({
    installationId: installation.id,
    slackUserId,
    mogplexUserId: matchedProfileId,
    slackEmail,
  });

  return matchedProfileId
    ? { mode: "legacy_email", mogplexUserId: null, slackEmail }
    : { mode: "unmapped", mogplexUserId: null, slackEmail };
}

async function findProfileGithubUsername(profileId: string | null) {
  if (!profileId) return null;
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("github_username")
    .eq("id", profileId)
    .maybeSingle();
  if (error) {
    console.warn("[slack-event] github username lookup failed", {
      profileId,
      error,
    });
    return null;
  }
  const githubUsername = data?.github_username;
  return typeof githubUsername === "string" && githubUsername.trim()
    ? githubUsername.trim()
    : null;
}

async function defaultReserveSlackRepoAgentMonthlyRun(input: {
  installationId: string;
  teamId: string;
  eventId: string;
  monthStartDate: string;
  monthlyLimit: number;
}): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc(
    "reserve_slack_repo_agent_monthly_run",
    {
      p_slack_installation_id: input.installationId,
      p_team_id: input.teamId,
      p_month_start: input.monthStartDate,
      p_slack_event_id: input.eventId,
      p_monthly_limit: input.monthlyLimit,
    }
  );

  if (error) {
    throw new Error(
      `Failed to reserve Slack repo-agent monthly quota: ${error.message}`
    );
  }
  return data === true;
}

async function defaultReleaseSlackRepoAgentMonthlyRun(input: {
  teamId: string;
  eventId: string;
  monthStartDate: string;
}): Promise<void> {
  const { error } = await supabaseAdmin.rpc(
    "release_slack_repo_agent_monthly_run",
    {
      p_team_id: input.teamId,
      p_month_start: input.monthStartDate,
      p_slack_event_id: input.eventId,
    }
  );

  if (error) {
    throw new Error(
      `Failed to release Slack repo-agent monthly quota: ${error.message}`
    );
  }
}

async function loadConversationById(conversationId: string) {
  const { data, error } = await supabaseAdmin
    .from("conversations")
    .select("id, user_id, messages, model, title, updated_at")
    .eq("id", conversationId)
    .single();
  if (error || !data) {
    throw new Error(
      `Failed to load linked conversation ${conversationId}: ${
        error?.message ?? "missing row"
      }`
    );
  }
  return data as ConversationRow;
}

async function safeDeleteConversation(conversationId: string) {
  const { error } = await supabaseAdmin
    .from("conversations")
    .delete()
    .eq("id", conversationId);
  if (error) {
    console.warn("[slack-event] failed to clean up unused conversation", {
      conversationId,
      error,
    });
  }
}

async function loadBoundConversation(input: {
  installationId: string;
  channelId: string;
  threadTs: string;
}) {
  const existing = await getSlackThreadConversation({
    installationId: input.installationId,
    channelId: input.channelId,
    threadTs: input.threadTs,
  });

  if (!existing) return null;
  return loadConversationById(existing.conversation_id);
}

async function defaultLoadOrCreateConversation(input: {
  installation: SlackInstallationRow;
  channelId: string;
  threadTs: string;
  mogplexUserId: string;
  requireExisting?: boolean;
}): Promise<ConversationRow | null> {
  const bound = await loadBoundConversation({
    installationId: input.installation.id,
    channelId: input.channelId,
    threadTs: input.threadTs,
  });
  if (bound) return bound;
  if (input.requireExisting) return null;

  const conversationId = crypto.randomUUID();
  const title = `Slack: ${input.channelId}`;
  const now = new Date().toISOString();
  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("conversations")
    .insert({
      id: conversationId,
      user_id: input.mogplexUserId,
      messages: [],
      title,
      updated_at: now,
    })
    .select("id, user_id, messages, model, title, updated_at")
    .single();
  if (insertError || !inserted) {
    throw new Error(
      `Failed to create Slack-backed conversation: ${
        insertError?.message ?? "no row"
      }`
    );
  }

  try {
    await bindSlackThreadToConversation({
      installationId: input.installation.id,
      channelId: input.channelId,
      threadTs: input.threadTs,
      conversationId,
    });
  } catch (error) {
    await safeDeleteConversation(conversationId);
    if (!(error instanceof SlackThreadConversationAlreadyBoundError)) {
      throw error;
    }
    const winner = await loadBoundConversation({
      installationId: input.installation.id,
      channelId: input.channelId,
      threadTs: input.threadTs,
    });
    if (!winner) {
      throw new Error("Slack thread binding conflict resolved without a row", {
        cause: error,
      });
    }
    return winner;
  }

  return inserted as ConversationRow;
}

async function defaultPersistConversation(input: {
  conversationId: string;
  userId: string;
  messages: RunChatAgentMessage[];
  expectedUpdatedAt?: string | null;
}) {
  if (!input.expectedUpdatedAt) {
    throw new Error(
      "Missing expected_updated_at for Slack conversation update"
    );
  }

  const { data, error } = await supabaseAdmin
    .from("conversations")
    .update({
      messages: input.messages,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.conversationId)
    .eq("user_id", input.userId)
    .eq("updated_at", input.expectedUpdatedAt)
    .select("id")
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to persist conversation: ${error.message}`);
  }
  if (!data) {
    throw new SlackConversationPersistConflictError(
      await loadConversationById(input.conversationId)
    );
  }
}

async function persistConversationTurn(input: {
  deps: SlackEventTaskDeps;
  conversation: ConversationRow;
  turnMessages: RunChatAgentMessage[];
}) {
  let latest = input.conversation;
  let lastConflict: SlackConversationPersistConflictError | null = null;

  // Optimistic-lock retry: a concurrent turn on the same thread can bump
  // `updated_at` between our read and write. Three attempts comfortably covers
  // realistic contention (Slack thread events are already serialized by the
  // task's concurrencyKey, so a collision here is rare) without risking a
  // runaway loop if something keeps writing.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await input.deps.persistConversation({
        conversationId: latest.id,
        userId: latest.user_id,
        messages: [...latest.messages, ...input.turnMessages],
        expectedUpdatedAt: latest.updated_at,
      });
      return;
    } catch (error) {
      if (!(error instanceof SlackConversationPersistConflictError)) {
        throw error;
      }
      lastConflict = error;
      latest = error.conversation;
    }
  }

  if (lastConflict) throw lastConflict;
  throw new Error("Failed to persist Slack conversation turn");
}

function readSlackMessageRef(key: string): SlackPostedMessageRef | null {
  let stored: unknown;
  try {
    stored = metadata.get(key);
  } catch {
    return null;
  }
  if (!stored || typeof stored !== "object") return null;
  const ref = stored as Partial<SlackPostedMessageRef>;
  if (
    typeof ref.channel !== "string" ||
    typeof ref.ts !== "string" ||
    typeof ref.threadTs !== "string" ||
    typeof ref.eventId !== "string"
  ) {
    return null;
  }
  return {
    channel: ref.channel,
    ts: ref.ts,
    threadTs: ref.threadTs,
    eventId: ref.eventId,
  };
}

async function saveSlackMessageRef(key: string, ref: SlackPostedMessageRef) {
  try {
    await metadata.set(key, ref).flush();
  } catch {
    // Trigger metadata is only available inside a task run. Unit tests call the
    // pure task body directly, so metadata persistence is best-effort there.
  }
}

async function postOrReuseSlackMessage(input: {
  deps: SlackEventTaskDeps;
  botToken: string;
  channelId: string;
  // Cache identity key for idempotent retries. For one-to-one DMs this stays
  // bound to the inbound thread even when the outbound message is top-level.
  threadTs: string;
  // Slack API `thread_ts` for the message being posted. Omit for top-level DMs.
  postThreadTs?: string;
  eventId: string;
  metadataKey: string;
  text: string;
}) {
  const stored = readSlackMessageRef(input.metadataKey);
  if (
    stored?.channel === input.channelId &&
    stored.threadTs === input.threadTs &&
    stored.eventId === input.eventId
  ) {
    return { channel: stored.channel, ts: stored.ts };
  }

  const posted = await input.deps.postMessage(input.botToken, {
    channel: input.channelId,
    thread_ts: input.postThreadTs,
    text: input.text,
  });
  await saveSlackMessageRef(input.metadataKey, {
    channel: posted.channel,
    ts: posted.ts,
    threadTs: input.threadTs,
    eventId: input.eventId,
  });
  return posted;
}

async function updateMessageBestEffort(
  deps: SlackEventTaskDeps,
  botToken: string,
  input: Parameters<typeof updateSlackMessage>[1],
  context: string
) {
  try {
    await deps.updateMessage(botToken, input);
  } catch (error) {
    console.warn(`[slack-event] ${context} failed`, error);
  }
}

export function createDebouncedSlackUpdater(input: {
  botToken: string;
  channel: string;
  ts: string;
  updateMessage: typeof updateSlackMessage;
  minIntervalMs?: number;
  now?: () => number;
}) {
  const minIntervalMs = input.minIntervalMs ?? SLACK_UPDATE_MIN_INTERVAL_MS;
  const now = input.now ?? Date.now;
  let lastSentText = "";
  let lastSentAt = 0;
  let inFlight: Promise<void> | null = null;

  const pushUpdate = async function pushUpdate(latestText: string) {
    if (latestText === lastSentText) return;
    if (inFlight) return; // collapse concurrent attempts
    const elapsed = now() - lastSentAt;
    if (elapsed < minIntervalMs) return;

    lastSentText = latestText;
    lastSentAt = now();

    inFlight = input
      .updateMessage(input.botToken, {
        channel: input.channel,
        ts: input.ts,
        text: latestText,
      })
      .then(() => undefined)
      .catch((error) => {
        console.warn("[slack-event] streaming chat.update failed", error);
      })
      .finally(() => {
        inFlight = null;
      });
  };

  return Object.assign(pushUpdate, {
    async flush() {
      if (inFlight) await inFlight;
    },
  });
}

type PreparedSlackAttachments = {
  contentParts: RunChatAgentContentPart[];
  notices: string[];
  attachedCount: number;
  droppedCount: number;
};

type PreparedSlackRepoAgentAttachments = {
  files: SlackRunImageAttachment[];
  notices: string[];
  attachedCount: number;
  droppedCount: number;
};

function logSlackAttachmentSkipped(input: {
  reason: "size" | "fetch_failed";
  attachmentId: string;
  mimetype: string;
  sizeBytes?: number;
  error?: unknown;
}) {
  console.warn("[slack-event] slack.attachment.skipped", input);
}

function appendSlackAttachmentNotices(text: string, notices: string[]): string {
  if (notices.length === 0) return text;
  return [text, ...notices].filter(Boolean).join("\n\n");
}

function buildSlackAttachmentPayloadNotices(
  notices: SlackEventAttachmentNotice[] | undefined
): string[] {
  return (notices ?? []).map((notice) => {
    if (notice.reason === "count_cap") {
      return `(showing first ${SLACK_IMAGE_ATTACHMENT_MAX_COUNT} of ${
        notice.count + SLACK_IMAGE_ATTACHMENT_MAX_COUNT
      } attached images)`;
    }
    return "";
  });
}

function isTooLarge(sizeBytes: number | undefined): boolean {
  return (
    typeof sizeBytes === "number" &&
    Number.isFinite(sizeBytes) &&
    sizeBytes > SLACK_IMAGE_ATTACHMENT_MAX_BYTES
  );
}

function responseContentLength(response: Response): number | undefined {
  const header = response.headers.get("content-length");
  if (!header) return undefined;
  const parsed = Number(header);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function fetchSlackAttachmentDataUrl(input: {
  deps: Pick<SlackEventTaskDeps, "fetchAttachment">;
  botToken: string;
  attachment: SlackEventAttachment;
}): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    SLACK_IMAGE_ATTACHMENT_FETCH_TIMEOUT_MS
  );
  try {
    const response = await input.deps.fetchAttachment({
      botToken: input.botToken,
      url: input.attachment.urlPrivateDownload,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Slack file fetch failed with ${response.status}`);
    }
    const contentLength = responseContentLength(response);
    if (isTooLarge(contentLength)) {
      throw new RangeError("Slack file is too large");
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > SLACK_IMAGE_ATTACHMENT_MAX_BYTES) {
      throw new RangeError("Slack file is too large");
    }
    return `data:${input.attachment.mimetype};base64,${bytes.toString(
      "base64"
    )}`;
  } finally {
    clearTimeout(timeout);
  }
}

async function prepareSlackAttachments(input: {
  deps: Pick<SlackEventTaskDeps, "fetchAttachment">;
  botToken: string;
  payload: SlackEventTaskPayload;
}): Promise<PreparedSlackAttachments> {
  const contentParts: RunChatAgentContentPart[] = [];
  const notices = buildSlackAttachmentPayloadNotices(
    input.payload.attachmentNotices
  );
  let droppedCount = input.payload.attachmentDroppedCount ?? 0;

  for (const attachment of input.payload.attachments ?? []) {
    if (isTooLarge(attachment.sizeBytes)) {
      droppedCount += 1;
      notices.push("(image too large)");
      logSlackAttachmentSkipped({
        reason: "size",
        attachmentId: attachment.id,
        mimetype: attachment.mimetype,
        sizeBytes: attachment.sizeBytes,
      });
      continue;
    }

    try {
      const dataUrl = await fetchSlackAttachmentDataUrl({
        deps: input.deps,
        botToken: input.botToken,
        attachment,
      });
      contentParts.push({
        type: "file",
        mediaType: attachment.mimetype,
        url: dataUrl,
        filename: attachment.name,
      });
    } catch (error) {
      droppedCount += 1;
      if (error instanceof RangeError) {
        notices.push("(image too large)");
        logSlackAttachmentSkipped({
          reason: "size",
          attachmentId: attachment.id,
          mimetype: attachment.mimetype,
          sizeBytes: attachment.sizeBytes,
        });
      } else {
        notices.push("(couldn't load attached image)");
        logSlackAttachmentSkipped({
          reason: "fetch_failed",
          attachmentId: attachment.id,
          mimetype: attachment.mimetype,
          sizeBytes: attachment.sizeBytes,
          error,
        });
      }
    }
  }

  return {
    contentParts,
    notices,
    attachedCount: contentParts.length,
    droppedCount,
  };
}

function prepareSlackRepoAgentAttachments(
  payload: SlackEventTaskPayload
): PreparedSlackRepoAgentAttachments {
  const files: SlackRunImageAttachment[] = [];
  const notices = buildSlackAttachmentPayloadNotices(payload.attachmentNotices);
  let droppedCount = payload.attachmentDroppedCount ?? 0;

  for (const attachment of payload.attachments ?? []) {
    if (isTooLarge(attachment.sizeBytes)) {
      droppedCount += 1;
      notices.push("(image too large)");
      logSlackAttachmentSkipped({
        reason: "size",
        attachmentId: attachment.id,
        mimetype: attachment.mimetype,
        sizeBytes: attachment.sizeBytes,
      });
      continue;
    }
    files.push(attachment);
  }

  return {
    files,
    notices,
    attachedCount: files.length,
    droppedCount,
  };
}

function buildSlackRepoAgentPrompt(input: {
  text: string;
  attachments: PreparedSlackRepoAgentAttachments;
}) {
  const baseText =
    input.text ||
    (input.attachments.attachedCount > 0
      ? "Please inspect the attached Slack image and address what it shows in this repository."
      : "");
  return appendSlackAttachmentNotices(baseText, input.attachments.notices);
}

function buildSlackUserMessage(input: {
  text: string;
  attachments: PreparedSlackAttachments;
}): { agent: RunChatAgentMessage; persistedText: string } {
  const hasTextOrAttachedImage =
    Boolean(input.text) || input.attachments.contentParts.length > 0;
  const baseText = hasTextOrAttachedImage
    ? input.text || "Please analyze the attached image."
    : "";
  const textWithNotices = appendSlackAttachmentNotices(
    baseText,
    input.attachments.notices
  );
  const content: RunChatAgentMessage["content"] =
    input.attachments.contentParts.length > 0
      ? [
          { type: "text", text: textWithNotices },
          ...input.attachments.contentParts,
        ]
      : textWithNotices;

  return {
    agent: { role: "user", content },
    persistedText: textWithNotices,
  };
}

async function resolveRepoAgentChannelLink(input: {
  deps: Pick<SlackEventTaskDeps, "getChannelLink">;
  installation: SlackInstallationRow;
  payload: SlackEventTaskPayload;
  userText: string;
}): Promise<SlackChannelLinkRow | null> {
  if (input.payload.eventType !== "app_mention") return null;
  if (!hasSlackUserInput(input.payload, input.userText)) return null;
  return input.deps.getChannelLink({
    installationId: input.installation.id,
    channelId: input.payload.channelId,
  });
}

type SlackChannelLinkState =
  | "direct_message"
  | "bound_thread"
  | "linked"
  | "unlinked"
  | "unknown";

function resolveSlackChannelLinkState(input: {
  payload: SlackEventTaskPayload;
  userText: string;
  channelLink: SlackChannelLinkRow | null;
}): SlackChannelLinkState {
  if (isSlackDirectConversation(input.payload)) return "direct_message";
  if (
    input.payload.eventType !== "app_mention" ||
    !hasSlackUserInput(input.payload, input.userText)
  ) {
    return "unknown";
  }
  return input.channelLink ? "linked" : "unlinked";
}

function resolveSlackConversationLinkState(input: {
  payload: SlackEventTaskPayload;
  channelLinkState: SlackChannelLinkState;
}): SlackChannelLinkState {
  if (input.channelLinkState !== "unknown") return input.channelLinkState;
  if (
    input.payload.eventType === "message" &&
    !isSlackDirectConversation(input.payload)
  ) {
    return "bound_thread";
  }
  return "unknown";
}

function requiresExistingSlackConversation(payload: SlackEventTaskPayload) {
  return payload.eventType === "message" && !isSlackDirectConversation(payload);
}

function isSlackDirectConversation(payload: SlackEventTaskPayload) {
  return payload.channelType === "im" || payload.channelType === "mpim";
}

function isUninvokedSlackGroupMessage(
  payload: SlackEventTaskPayload,
  botUserId: string
) {
  if (payload.channelType !== "mpim") return false;
  if (payload.eventType === "app_mention") return false;

  for (const match of payload.text.matchAll(/<@([A-Za-z0-9]+)(?:\|[^>]*)?>/g)) {
    if (match[1] === botUserId) return false;
  }
  return true;
}

async function loadBoundSlackGroupConversation(input: {
  deps: Pick<SlackEventTaskDeps, "loadBoundConversation">;
  installation: SlackInstallationRow;
  payload: SlackEventTaskPayload;
}): Promise<ConversationRow | null | undefined> {
  if (
    !isUninvokedSlackGroupMessage(input.payload, input.installation.bot_user_id)
  ) {
    return undefined;
  }
  return input.deps.loadBoundConversation({
    installationId: input.installation.id,
    channelId: input.payload.channelId,
    threadTs: input.payload.threadTs,
  });
}

function getSlackReplyThreadTs(payload: SlackEventTaskPayload) {
  if (payload.channelType === "im") return undefined;
  return payload.threadTs;
}

function hasSlackUserInput(
  payload: SlackEventTaskPayload,
  userText: string
): boolean {
  return (
    userText.length > 0 ||
    (payload.attachments?.length ?? 0) > 0 ||
    (payload.attachmentNotices?.length ?? 0) > 0
  );
}

function buildSlackConversationalSystemSuffix(input: {
  channelLinkState: SlackChannelLinkState;
  attribution: SlackAttribution;
}) {
  const location =
    input.channelLinkState === "direct_message"
      ? "- This is a Slack direct or group message."
      : input.channelLinkState === "bound_thread"
        ? "- This Slack thread is continuing an existing Mogplex conversation."
        : input.channelLinkState === "unlinked"
          ? "- This Slack channel is not linked to a Mogplex repository."
          : input.channelLinkState === "linked"
            ? "- This Slack channel is linked to a Mogplex repository."
            : "- This Slack thread may not have repository context.";
  const githubIdentity = input.attribution.githubUsername
    ? `- The current Slack user is linked to GitHub username "${input.attribution.githubUsername}". When the user says "I", "me", or "my" about GitHub, use that username as their identity.`
    : '- The current Slack user has no known GitHub username in Mogplex. If a GitHub request depends on "I", "me", or "my", say that you cannot identify their GitHub username yet.';

  return `<slack_context>
You are replying in Slack through the Mogplex app.
${location}
${githubIdentity}
- Do not say "No active repo selected" or ask the user to select a repo in the web app. Give Slack-native next steps.
- Continue from this thread's prior messages. If the user confirms, says yes, go, execute, or proceed, treat that as approval of the most recent proposed action.
- Ask at most one blocking question when scope, credentials, or a destructive choice is missing. For repo scope, ask for "all connected repos" or owner/repo slugs.
- For GitHub PR inventory questions across an org, user, repo, or "my PRs", use authenticated GitHub PR search when available. Do not use public web search for these unless the user explicitly asks for public-only results.
- If authenticated GitHub PR search returns results, do not add a generic public/private repo caveat. If authenticated search is unavailable or errors for that PR-inventory request, say exactly that and ask the user to connect GitHub or install the GitHub App for the requested owner.
- When the user explicitly asks to create a GitHub issue, use authenticated GitHub issue creation and return the created issue link. Never claim GitHub is read-only without attempting that capability.
- For dependency, security, release, CVE, or latest-version claims, use web_search and then web_fetch on authoritative sources before answering.
- Prefer same-major patched versions for dependency security work. Do not propose major upgrades unless the user explicitly asks.
- Use Slack mrkdwn, not GitHub Markdown: links must be <https://example.com|label> and bold text uses single *asterisks*.
- Do not narrate hidden reasoning, tool retries, transient tool errors, or attempts. Share the final result and only concise, actionable caveats.
- Keep Slack replies concise. Do not present option menus or long implementation checklists unless the user asks for a plan.
</slack_context>`;
}

function sanitizeSlackLinkLabel(label: string) {
  const sanitized = label.replace(/[<>|]/g, "").trim();
  return sanitized || "link";
}

export function formatSlackConversationalReply(text: string) {
  return text
    .replace(
      /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,
      (_match, label: string, url: string) =>
        `<${url}|${sanitizeSlackLinkLabel(label)}>`
    )
    .replace(/\*\*([^\n*][^\n]*?)\*\*/g, "*$1*");
}

async function sendSlackAccountLinkNotice(input: {
  deps: SlackEventTaskDeps;
  installation: SlackInstallationRow;
  botToken: string;
  payload: SlackEventTaskPayload;
  attribution: SlackAttribution;
}) {
  const linkToken = await input.deps.createUserLinkToken({
    installationId: input.installation.id,
    teamId: input.payload.teamId,
    slackUserId: input.payload.slackUserId,
  });
  if (!linkToken) return;

  // The URL contains a short-lived single-use bearer token. Storage keeps only
  // its hash, but Slack message history can expose the plaintext link until the
  // token expires or is consumed.
  const linkUrl = input.deps.buildSlackLinkUrl(linkToken.token);
  const text =
    input.attribution.mode === "legacy_email"
      ? `:lock: I found a Mogplex account with your Slack email, but you still need to explicitly link Slack before I can act for you: ${linkUrl}`
      : `:lock: Link your Slack account to Mogplex before I can act for you: ${linkUrl}`;

  if (input.payload.channelType === "im") {
    await input.deps.postMessage(input.botToken, {
      channel: input.payload.channelId,
      text,
    });
    return;
  }

  // Account-link URLs are short-lived bearer tokens. Keep them private via an
  // ephemeral channel notice, but post into the visible channel surface instead
  // of a thread so the user can actually find the one-time link.
  await input.deps.postEphemeral(input.botToken, {
    channel: input.payload.channelId,
    user: input.payload.slackUserId,
    text,
  });
}

export async function runSlackEventTask(
  payload: SlackEventTaskPayload,
  overrides: Partial<SlackEventTaskDeps> = {}
): Promise<SlackEventTaskResult> {
  const deps: SlackEventTaskDeps = { ...defaultDeps, ...overrides };

  const installation = await deps.getInstallation(payload.teamId);
  if (!installation) return { outcome: "unknown_workspace" };

  // Defense in depth: webhook already drops bot-authored events, but a future
  // event type might slip through. Never let the bot reply to itself.
  if (payload.slackUserId === installation.bot_user_id) {
    return { outcome: "ignored_self_message" };
  }

  const userText = stripSlackMention(payload.text ?? "");
  if (!hasSlackUserInput(payload, userText)) {
    return { outcome: "skipped_empty_text" };
  }

  const boundGroupConversation = await loadBoundSlackGroupConversation({
    deps,
    installation,
    payload,
  });
  if (boundGroupConversation === null) {
    return { outcome: "ignored_uninvoked_group_message" };
  }

  const botToken = await deps.getBotToken(payload.teamId);
  if (!botToken) return { outcome: "unknown_workspace" };

  const attribution = await deps.resolveSlackAttribution(
    installation,
    payload.slackUserId,
    botToken
  );
  const mogplexUserId = attribution.mogplexUserId;
  if (!mogplexUserId) {
    await sendSlackAccountLinkNotice({
      deps,
      installation,
      botToken,
      payload,
      attribution,
    });
    return {
      outcome: "ignored_no_mogplex_user",
      mogplexUserId: null,
    };
  }

  const channelLink = await resolveRepoAgentChannelLink({
    deps,
    installation,
    payload,
    userText,
  });
  const channelLinkState = resolveSlackChannelLinkState({
    payload,
    userText,
    channelLink,
  });
  if (channelLink) {
    return runRepoAgentMode({
      deps,
      payload,
      botToken,
      mogplexUserId,
      attribution,
      installation,
      channelLink,
      userText,
    });
  }

  return runConversationalMode({
    deps,
    payload,
    installation,
    botToken,
    mogplexUserId,
    attribution,
    userText,
    channelLinkState,
    boundConversation: boundGroupConversation,
  });
}

async function runConversationalMode(input: {
  deps: SlackEventTaskDeps;
  payload: SlackEventTaskPayload;
  installation: SlackInstallationRow;
  botToken: string;
  mogplexUserId: string;
  attribution: SlackAttribution;
  userText: string;
  channelLinkState: SlackChannelLinkState;
  boundConversation?: ConversationRow;
}): Promise<SlackEventTaskResult> {
  const {
    deps,
    payload,
    installation,
    botToken,
    mogplexUserId,
    attribution,
    userText,
    channelLinkState,
    boundConversation,
  } = input;

  const conversation =
    boundConversation ??
    (await deps.loadOrCreateConversation({
      installation,
      channelId: payload.channelId,
      threadTs: payload.threadTs,
      mogplexUserId,
      requireExisting: requiresExistingSlackConversation(payload),
    }));
  if (!conversation) {
    return {
      outcome: "ignored_unbound_thread_message",
      mogplexUserId,
    };
  }
  const resolvedChannelLinkState = resolveSlackConversationLinkState({
    payload,
    channelLinkState,
  });
  const postThreadTs = getSlackReplyThreadTs(payload);
  const attachments = await prepareSlackAttachments({
    deps,
    botToken,
    payload,
  });

  const placeholder = await postOrReuseSlackMessage({
    deps,
    botToken,
    channelId: payload.channelId,
    threadTs: payload.threadTs,
    postThreadTs,
    eventId: payload.eventId,
    metadataKey: "slackConversationalPlaceholder",
    text: PLACEHOLDER_TEXT,
  });

  // Window the thread history before sending it to the agent — a long Slack
  // thread would otherwise grow the prompt unbounded. Full history is still
  // persisted by `persistConversationTurn` below.
  const userMessage = buildSlackUserMessage({
    text: userText,
    attachments,
  });
  const messages: RunChatAgentMessage[] = windowMessages([
    ...conversation.messages,
    userMessage.agent,
  ]);

  let agentResult: Awaited<ReturnType<typeof runChatAgent>>;
  try {
    agentResult = await deps.runAgent({
      userId: mogplexUserId,
      messages,
      conversationId: conversation.id,
      // Each Slack event runs exactly one conversational agent pass. Reusing
      // this scope for another pass would intentionally replay matching calls.
      toolExecutionIdempotencyKey:
        buildSlackToolExecutionIdempotencyKey(payload),
      systemSuffix: buildSlackConversationalSystemSuffix({
        channelLinkState: resolvedChannelLinkState,
        attribution,
      }),
    });
  } catch (error) {
    console.error("[slack-event] conversational agent failed", {
      teamId: payload.teamId,
      eventId: payload.eventId,
      error,
    });
    await updateMessageBestEffort(
      deps,
      botToken,
      {
        channel: payload.channelId,
        ts: placeholder.ts,
        text: ":warning: Mogplex hit an error while responding. Try again from Slack or open Mogplex for details.",
      },
      "agent error placeholder update"
    );
    throw error;
  }

  const finalText = formatSlackConversationalReply(
    agentResult.finalText || "_(no response)_"
  );

  await deps.updateMessage(botToken, {
    channel: payload.channelId,
    ts: placeholder.ts,
    text: finalText,
  });

  await persistConversationTurn({
    deps,
    conversation,
    turnMessages: [
      { role: "user", content: userMessage.persistedText },
      { role: "assistant", content: finalText },
    ],
  });

  return {
    outcome: "conversational_reply",
    conversationId: conversation.id,
    mogplexUserId,
    attachments_attached: attachments.attachedCount,
    attachments_dropped: attachments.droppedCount,
  };
}

async function runRepoAgentMode(input: {
  deps: SlackEventTaskDeps;
  payload: SlackEventTaskPayload;
  botToken: string;
  mogplexUserId: string;
  attribution: SlackAttribution;
  installation: SlackInstallationRow;
  channelLink: SlackChannelLinkRow;
  userText: string;
}): Promise<SlackEventTaskResult> {
  const {
    deps,
    payload,
    botToken,
    mogplexUserId,
    attribution,
    installation,
    channelLink,
    userText,
  } = input;

  const policy = await evaluateSlackRepoAgentPolicy({
    deps,
    eventId: payload.eventId,
    installation,
    slackUserId: payload.slackUserId,
  });
  if (!policy.allowed) {
    // Repo-agent policy denials originate from app_mention events, so keep the
    // notice grouped under the Slack thread that invoked the agent.
    await deps.postMessage(botToken, {
      channel: payload.channelId,
      thread_ts: payload.threadTs,
      text: policy.message,
    });
    return {
      outcome: policy.outcome,
      mogplexUserId,
    };
  }

  const attachments = prepareSlackRepoAgentAttachments(payload);
  const prompt = buildSlackRepoAgentPrompt({
    text: userText,
    attachments,
  });
  if (!prompt.trim()) {
    return { outcome: "skipped_empty_text", mogplexUserId };
  }

  let placeholder: { channel: string; ts: string } | null = null;
  let runStart: StartRepoAgentRunResult;
  try {
    const postedPlaceholder = await postOrReuseSlackMessage({
      deps,
      botToken,
      channelId: payload.channelId,
      threadTs: payload.threadTs,
      postThreadTs: payload.threadTs,
      eventId: payload.eventId,
      metadataKey: "slackRepoAgentPlaceholder",
      text: ":robot_face: Starting repo agent run…",
    });
    placeholder = postedPlaceholder;

    runStart = await deps.startRepoAgentRun({
      mogplexUserId,
      repoId: channelLink.repo_id,
      prompt,
      // Slack `event_id` is unique per delivery — reuse so retries dedupe.
      idempotencyKey: `slack:${payload.eventId}`,
      slackContext: {
        mode: "repo_agent",
        teamId: payload.teamId,
        installationId: installation.id,
        channelId: payload.channelId,
        slackUserId: payload.slackUserId,
        slackEmail: attribution.slackEmail,
        attributionMode: attribution.mode,
      },
      slackMessage: {
        teamId: payload.teamId,
        channelId: payload.channelId,
        messageTs: postedPlaceholder.ts,
      },
      slackAttachments: attachments.files,
      slackAttachmentDroppedCount: attachments.droppedCount,
    });
  } catch (error) {
    console.error("[slack-event] repo-agent start failed", {
      teamId: payload.teamId,
      eventId: payload.eventId,
      error,
    });
    const message =
      ":warning: Couldn't start the run. Open Mogplex for details or try again.";
    if (policy.quotaReservation) {
      // Release before notifying; both steps are best-effort and swallow failures.
      await releaseSlackRepoAgentQuotaReservationBestEffort(
        deps,
        policy.quotaReservation
      );
    }
    await (placeholder
      ? updateMessageBestEffort(
          deps,
          botToken,
          {
            channel: payload.channelId,
            ts: placeholder.ts,
            text: message,
          },
          "repo-agent error placeholder update"
        )
      : postMessageBestEffort(
          deps,
          botToken,
          {
            channel: payload.channelId,
            thread_ts: payload.threadTs,
            text: message,
          },
          "repo-agent error notice"
        ));
    throw error;
  }

  if (!placeholder) {
    throw new Error("Slack repo-agent placeholder was not created");
  }

  const runUrl = deps.buildRunUrl(runStart.runId);
  const startedText = buildRepoAgentRunStartedText(runStart.runId, runUrl);
  await deps.updateMessage(botToken, {
    channel: payload.channelId,
    ts: placeholder.ts,
    text: startedText,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: startedText } },
      // This block is stripped either reactively (the interactivity handler,
      // when the button is clicked on a finished run / once a cancel is in
      // flight — see `removeCancelButton` in lib/slack/interactivity.ts) or
      // proactively by the run-completion hook in lib/mogplex-api/run-execution.ts.
      buildCancelRunActionsBlock(runStart.runId),
    ],
  });

  return {
    outcome: "repo_agent_run_started",
    mogplexUserId,
    runId: runStart.runId,
    attachments_attached: attachments.attachedCount,
    attachments_dropped: attachments.droppedCount,
  };
}

async function releaseSlackRepoAgentQuotaReservationBestEffort(
  deps: Pick<SlackEventTaskDeps, "releaseSlackRepoAgentMonthlyRun">,
  reservation: { teamId: string; eventId: string; monthStartDate: string }
) {
  try {
    await deps.releaseSlackRepoAgentMonthlyRun(reservation);
  } catch (error) {
    console.warn("[slack-event] failed to release repo-agent quota", {
      teamId: reservation.teamId,
      eventId: reservation.eventId,
      monthStartDate: reservation.monthStartDate,
      error,
    });
  }
}

async function postMessageBestEffort(
  deps: Pick<SlackEventTaskDeps, "postMessage">,
  botToken: string,
  input: Parameters<SlackEventTaskDeps["postMessage"]>[1],
  label: string
) {
  try {
    await deps.postMessage(botToken, input);
  } catch (error) {
    console.warn(`[slack-event] ${label} failed`, error);
  }
}

type SlackRepoAgentPolicy =
  | {
      allowed: true;
      quotaReservation?: {
        teamId: string;
        eventId: string;
        monthStartDate: string;
      };
    }
  | {
      allowed: false;
      outcome:
        | "repo_agent_disabled"
        | "repo_agent_user_not_allowed"
        | "repo_agent_monthly_limit_reached";
      message: string;
    };

function monthStartDate(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);
}

async function evaluateSlackRepoAgentPolicy(input: {
  deps: Pick<SlackEventTaskDeps, "now" | "reserveSlackRepoAgentMonthlyRun">;
  eventId: string;
  installation: SlackInstallationRow;
  slackUserId: string;
}): Promise<SlackRepoAgentPolicy> {
  if (input.installation.repo_agent_enabled === false) {
    return {
      allowed: false,
      outcome: "repo_agent_disabled",
      message: ":lock: Repo agent runs are disabled for this Slack workspace.",
    };
  }

  const allowedUserIds = input.installation.allowed_slack_user_ids;
  if (
    Array.isArray(allowedUserIds) &&
    !allowedUserIds.includes(input.slackUserId)
  ) {
    return {
      allowed: false,
      outcome: "repo_agent_user_not_allowed",
      message:
        ":lock: You are not allowed to start repo agent runs from this Slack workspace.",
    };
  }

  const monthlyLimit = input.installation.monthly_repo_run_limit;
  if (typeof monthlyLimit === "number" && monthlyLimit > 0) {
    const quotaMonthStartDate = monthStartDate(input.deps.now());
    const reserved = await input.deps.reserveSlackRepoAgentMonthlyRun({
      installationId: input.installation.id,
      teamId: input.installation.team_id,
      eventId: input.eventId,
      monthStartDate: quotaMonthStartDate,
      monthlyLimit,
    });
    if (!reserved) {
      return {
        allowed: false,
        outcome: "repo_agent_monthly_limit_reached",
        message:
          ":warning: This Slack workspace has reached its monthly repo agent run limit.",
      };
    }

    return {
      allowed: true,
      quotaReservation: {
        teamId: input.installation.team_id,
        eventId: input.eventId,
        monthStartDate: quotaMonthStartDate,
      },
    };
  }

  return { allowed: true };
}

export const handleSlackEventTask = task({
  id: TRIGGER_TASK_IDS.slackEventHandler,
  maxDuration: SLACK_EVENT_TASK_MAX_DURATION_SECONDS,
  retry: { maxAttempts: 2 },
  run: async (payload: SlackEventTaskPayload) => {
    metadata.set("teamId", payload.teamId);
    metadata.set("eventId", payload.eventId);
    metadata.set("eventType", payload.eventType);
    metadata.set("channelType", payload.channelType);
    const workflowInstallation = await getSlackInstallationByTeamId(
      payload.teamId
    );
    const allowedSlackUsers = workflowInstallation?.allowed_slack_user_ids;
    const canDispatchWorkflow =
      !Array.isArray(allowedSlackUsers) ||
      allowedSlackUsers.includes(payload.slackUserId);
    if (
      payload.eventType === "app_mention" &&
      canDispatchWorkflow &&
      workflowInstallation
    ) {
      const workflowResults = await dispatchSlackMentionWorkflows({
        userId: workflowInstallation.installed_by_user_id,
        teamId: payload.teamId,
        channelId: payload.channelId,
        eventId: payload.eventId,
        slackUserId: payload.slackUserId,
        text: stripSlackMention(payload.text ?? ""),
        messageTs: payload.messageTs,
        threadTs: payload.threadTs,
      });
      const matched = workflowResults.filter((result) => result.matched);
      const runIds = matched.flatMap((result) =>
        result.jobRunId ? [result.jobRunId] : []
      );
      if (matched.length > 0) {
        metadata.set("workflowCount", matched.length);
        metadata.set("workflowRunIds", runIds);
        return {
          outcome:
            runIds.length > 0
              ? ("workflow_runs_started" as const)
              : ("workflow_mention_handled" as const),
          mogplexUserId: workflowInstallation.installed_by_user_id,
          runIds,
        };
      }
    }
    return runSlackEventTask(payload, {
      getInstallation: async () => workflowInstallation,
    });
  },
});

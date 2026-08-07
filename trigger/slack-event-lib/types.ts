import type {
  postSlackEphemeral,
  postSlackMessage,
  updateSlackMessage,
} from "@/lib/slack/client";
import type {
  SlackChannelLinkRow,
  SlackInstallationRow,
} from "@/lib/slack/installations";
import type { SlackRunImageAttachment } from "@/lib/slack/run-attachments";
import type { runChatAgent } from "@/lib/agents/run-chat-agent";
import type {
  RunChatAgentContentPart,
  RunChatAgentMessage,
} from "@/lib/agents/run-chat";

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

export type ConversationRow = {
  id: string;
  user_id: string;
  messages: RunChatAgentMessage[];
  model: string | null;
  title: string | null;
  updated_at?: string | null;
};

export type SlackPostedMessageRef = {
  channel: string;
  ts: string;
  threadTs: string;
  eventId: string;
};

export type SlackAttributionMode =
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
   * text) once the run reaches a terminal state - see issue #398.
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

export type PreparedSlackAttachments = {
  contentParts: RunChatAgentContentPart[];
  notices: string[];
  attachedCount: number;
  droppedCount: number;
};

export type PreparedSlackRepoAgentAttachments = {
  files: SlackRunImageAttachment[];
  notices: string[];
  attachedCount: number;
  droppedCount: number;
};

export type SlackChannelLinkState =
  | "direct_message"
  | "bound_thread"
  | "linked"
  | "unlinked"
  | "unknown";

export type SlackRepoAgentPolicy =
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

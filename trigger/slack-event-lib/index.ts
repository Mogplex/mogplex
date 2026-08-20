// Re-export types
export type {
  SlackEventAttachment,
  SlackEventAttachmentNotice,
  SlackEventTaskPayload,
  SlackEventTaskResult,
  SlackEventTaskDeps,
  SlackAttribution,
  SlackRepoAgentRunContext,
  StartRepoAgentRunInput,
  StartRepoAgentRunResult,
  ConversationRow,
  SlackPostedMessageRef,
  SlackAttributionMode,
  PreparedSlackAttachments,
  PreparedSlackRepoAgentAttachments,
  SlackChannelLinkState,
  SlackRepoAgentPolicy,
} from "./types";

// Re-export attribution functions
export {
  resolveKnownSlackAttribution,
  findProfileGithubUsername,
  defaultResolveSlackAttribution,
} from "./attribution";

// Re-export quota functions
export {
  monthStartDate,
  defaultReserveSlackRepoAgentMonthlyRun,
  defaultReleaseSlackRepoAgentMonthlyRun,
  releaseSlackRepoAgentQuotaReservationBestEffort,
} from "./quota";

// Re-export conversation functions
export {
  SlackConversationPersistConflictError,
  loadBoundConversation,
  defaultLoadOrCreateConversation,
  defaultPersistConversation,
  persistConversationTurn,
} from "./conversation";

// Re-export attachment functions
export {
  prepareSlackAttachments,
  prepareSlackRepoAgentAttachments,
  buildSlackRepoAgentPrompt,
  buildSlackUserMessage,
} from "./attachments";

// Re-export messaging functions
export {
  postOrReuseSlackMessage,
  updateMessageBestEffort,
  postMessageBestEffort,
  createDebouncedSlackUpdater,
  finalizeSlackUpdaterBestEffort,
  readSlackMessageRef,
  readSlackTerminalState,
  saveSlackTerminalState,
} from "./messaging";
export {
  createSlackAgentProgressHandler,
  formatSlackAgentProgress,
  SLACK_INITIAL_PROGRESS_TEXT,
} from "./progress";

// Re-export channel-state functions
export {
  resolveRepoAgentChannelLink,
  resolveSlackChannelLinkState,
  resolveSlackConversationLinkState,
  requiresExistingSlackConversation,
  isSlackDirectConversation,
  isUninvokedSlackGroupMessage,
  loadBoundSlackGroupConversation,
  getSlackReplyThreadTs,
  hasSlackUserInput,
} from "./channel-state";

// Re-export system functions
export {
  buildSlackConversationalSystemSuffix,
  formatSlackConversationalReply,
  sendSlackAccountLinkNotice,
} from "./system";

// Re-export policy functions
export { evaluateSlackRepoAgentPolicy } from "./policy";

// Re-export run-start functions
export { defaultStartRepoAgentRun, defaultBuildRunUrl } from "./run-start";

// Re-export mode functions
export {
  buildSlackToolExecutionIdempotencyKey,
  runConversationalMode,
  runRepoAgentMode,
} from "./modes";

/**
 * Flow wait service - main entry point.
 *
 * This module re-exports all wait service functionality from the split modules
 * for backwards compatibility. Core resume logic and providers are in
 * ./wait-service-core.ts, event routing in ./wait-service-routing.ts, and
 * approval operations in ./wait-service-approvals.ts.
 */

// Re-export core types and functions
export {
  findActiveFlowWaitsForEvent,
  loadStartFiltersForFlowIds,
  resumeFlowWait,
  supabaseWaitStore,
  triggerWaitProvider,
  type ResumeFlowWaitCandidate,
  type ResumeFlowWaitInput,
  type ResumeFlowWaitOutcome,
} from "./wait-service-core";

// Re-export routing functions
export {
  routeGithubCiCompletedEventToFlowWaits,
  routeGithubCommentAddedEventToFlowWaits,
  routeGithubLabeledEventToFlowWaits,
  routeGithubVercelPreviewReadyEventToFlowWaits,
  type GithubCiCompletedEvent,
  type GithubCommentAddedEvent,
  type GithubLabeledEvent,
  type GithubVercelPreviewReadyEvent,
  type RouteFlowWaitsOutcome,
  type RouteGithubLabeledOutcome,
} from "./wait-service-routing";

// Re-export approval functions
export {
  listPendingToolApprovals,
  loadOwnedToolApprovalWait,
  loadToolApprovalSpentWaitMs,
  type OwnedFlowApprovalWait,
  type OwnedToolApprovalWait,
  type PendingFlowApproval,
  type PendingToolApproval,
} from "./wait-service-approvals";

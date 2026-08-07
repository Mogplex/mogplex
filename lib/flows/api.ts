/**
 * Flow API - Unified entry point for flow operations
 *
 * This module re-exports from specialized submodules:
 * - api-crud.ts: Flow CRUD operations (create, update, delete, templates)
 * - api-flow-list.ts: Flow listing with summaries
 * - api-run-queries.ts: Flow run queries (list runs, run details)
 * - api-assistant.ts: AI assistant for flow graph generation
 */

// Flow CRUD operations
export {
  loadOwnedInstallation,
  createFlowForUser,
  listOwnedPersonalFlowTemplates,
  listFlowTemplates,
  createFlowTemplate,
  createPersonalFlowTemplate,
  deleteFlowTemplate,
  loadOwnedFlow,
  updateFlow,
  syncFlowActivation,
  publishFlowDraft,
  duplicateFlow,
  deleteFlow,
} from "@/lib/flows/api-crud";

// Flow listing with summaries
export { listOwnedFlowsWithSummaries } from "@/lib/flows/api-flow-list";

// Flow run queries
export {
  listOwnedFlowRuns,
  loadOwnedFlowRunDetail,
} from "@/lib/flows/api-run-queries";

// Flow assistant (AI)
export {
  extractLatestFlowAssistantGraphState,
  streamFlowAssistantChat,
  generateFlowAssistantSuggestion,
} from "@/lib/flows/api-assistant";

/**
 * E2E test store for flows - re-exports from split modules.
 *
 * This module provides an in-memory implementation of the flows data layer
 * used during Playwright E2E tests. The implementation is split across:
 * - test-store-types.ts: Type definitions and utilities
 * - test-store-state.ts: Global state management
 * - test-store-helpers.ts: Serialization and validation helpers
 * - test-store-runs.ts: Run-related operations
 * - test-store-flow-crud.ts: Flow CRUD operations
 * - test-store-templates.ts: Template operations
 * - test-store-assistant.ts: Assistant operations
 */

// Types
export type { FlowsE2ETestState } from "./test-store-types";

// State management
export {
  isFlowsE2ETestMode,
  resetFlowsE2ETestState,
  snapshotFlowsE2ETestState,
} from "./test-store-state";

// Run operations
export {
  listOwnedFlowRuns,
  listOwnedFlowsWithSummaries,
  loadOwnedFlowRunDetail,
} from "./test-store-runs";

// Flow CRUD
export {
  buildDefaultFlowDraft,
  createFlowForUser,
  deleteFlow,
  duplicateFlow,
  loadOwnedFlow,
  loadOwnedInstallation,
  publishFlowDraft,
  syncFlowActivation,
  updateFlow,
} from "./test-store-flow-crud";

// Templates
export {
  createFlowTemplate,
  createPersonalFlowTemplate,
  deleteFlowTemplate,
  listFlowTemplates,
  listOwnedPersonalFlowTemplates,
} from "./test-store-templates";

// Assistant
export { generateFlowAssistantSuggestion } from "./test-store-assistant";

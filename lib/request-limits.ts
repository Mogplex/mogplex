// Request rate limiting module.
// This file re-exports the public API from the request-limits/ submodules
// to maintain backward compatibility with existing imports.

// Types and constants
export {
  LIMIT_ROUTE_KEYS,
  REQUEST_LIMITS,
  type LimitRouteKey,
  type LimitDecision,
} from "./request-limits/types";

// Pure policy evaluation functions
export {
  evaluateChatLimitPolicy,
  evaluateSandboxBootLimitPolicy,
  evaluateExternalAgentRunLimitPolicy,
  evaluateSnapshotBuildLimitPolicy,
  evaluateSandboxExecLimitPolicy,
  buildSandboxExecConcurrencyDecision,
} from "./request-limits/policy";

// Response building and event recording
export {
  buildLimitResponse,
  recordLimitDecision,
} from "./request-limits/recording";

// Atomic claim logic
export { releaseLimitClaim } from "./request-limits/claims";

// Enforcement functions
export {
  enforceChatLimits,
  enforceSandboxBootLimits,
  enforceExternalAgentRunLimits,
  enforceSnapshotBuildLimits,
  enforceSandboxExecLimits,
  acquireSandboxExecLock,
  releaseSandboxExecLock,
} from "./request-limits/enforcement";

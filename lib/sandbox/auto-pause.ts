/**
 * Sandbox auto-pause system.
 *
 * This module re-exports all public types and functions from the split
 * implementation files to maintain backward compatibility with existing
 * imports from "@/lib/sandbox/auto-pause".
 *
 * Implementation is split across:
 *   - auto-pause-types.ts    — Type definitions and constants
 *   - auto-pause-presence.ts — Presence tracking and lifecycle events
 *   - auto-pause-runner.ts   — Main auto-pause runner and dependencies
 */

// Types and constants
export {
  DEFAULT_SANDBOX_AUTO_PAUSE_GRACE_PERIOD_MS,
  type SandboxClientPresenceEvent,
  type SandboxLifecycleEventType,
  type SandboxAutoPauseDecisionCode,
  type SandboxAutoPauseMode,
  type SandboxAutoPausePayload,
  type SandboxAutoPauseRecord,
  type SandboxPresenceInput,
  type SandboxReleaseInput,
  type SandboxClientReleaseResult,
  type SandboxAutoPauseResult,
} from "./auto-pause-types";

// Presence tracking and lifecycle event functions
export {
  normalizeSandboxPresencePayload,
  resolveSandboxAutoPauseGracePeriodMs,
  resolveSandboxAutoPauseMode,
  recordSandboxLifecycleEvent,
  recordSandboxClientAttach,
  recordSandboxClientRelease,
  queueSandboxAutoPauseCheck,
  buildActiveAiCallSandboxMetadataFilter,
} from "./auto-pause-presence";

// Main runner
export { runSandboxAutoPauseCheck } from "./auto-pause-runner";

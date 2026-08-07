/**
 * Sandbox client — facade re-exporting the public API from submodules.
 *
 * This file is the public interface. Implementation lives in:
 * - client-types.ts: Type definitions
 * - client-validation.ts: Validation, errors, persistent sandbox flags
 * - client-shell.ts: Shell command building, port extraction
 * - client-readiness.ts: Preview readiness detection, health checks
 * - client-lifecycle.ts: Sandbox CRUD operations
 * - client-bootstrap.ts: Bootstrap orchestration
 */

// Re-export types
export type {
  CreateSandboxOpts,
  CreateFromSnapshotOpts,
  BootstrapSandboxOpts,
  BaselineSnapshotBootstrapOpts,
  ResolvedBootstrapContext,
  PreviewReadyResult,
  PreviewReadinessOptions,
  SandboxBootstrapLogPhase,
  BootstrapDetection,
  BootstrapStrategy,
  SandboxStreamingCommand,
  PreviewSignalRaceWinner,
  SandboxBootstrapStreamEvent,
  NetworkPolicy,
  SandboxRuntime,
  RepoEnvVars,
  EnvSyncMode,
  LinkedVercelProject,
  SandboxHealthStatus,
} from "./client-types";

// Re-export validation, errors, and constants
export {
  MAX_SANDBOX_ENV_PAYLOAD_BYTES,
  DEFAULT_PERSISTENT_SNAPSHOT_EXPIRATION_MS,
  BOOTSTRAP_STEP_TIMEOUT_MS,
  measureSandboxEnvPayloadBytes,
  validateSandboxCreateRequest,
  persistentSandboxesDisabledByEnv,
  resolvePersistentSandboxOptions,
  isPersistentSandboxPermissionError,
  createWithPersistentFallback,
  SandboxBootstrapError,
  withTimeout,
} from "./client-validation";

// Re-export shell utilities
export {
  escapeShell,
  shellQuote,
  buildShellCommand,
  buildDetachedDevLaunchCommand,
  extractPortFromCommand,
  resolveDevPort,
  buildSelectiveRebuildCommand,
  sanitizeNextBundlerFlags,
  resolveBootstrapInstallCommand,
  resolveBootstrapDevCommand,
} from "./client-shell";

// Re-export preview readiness
export {
  DEV_SERVER_SIGNAL_TIMEOUT_MS,
  NO_DEV_SCRIPT_MESSAGE,
  logSignalsPreviewReady,
  extractBoundPortFromLog,
  replacePortInSandboxDomain,
  previewAllowsRoot404,
  buildPreviewReadinessOptions,
  retryPreviewHealth,
  extractDevLogTail,
  buildPreviewReadyResult,
  readSandboxTextFile,
  failPreviewBootstrap,
  resolvePreviewHealthResult,
  resolveRetriedPreviewHealthResult,
  createPreviewSignalTimeoutPromise,
  createPreviewSignalExitPromise,
  nextPreviewSignalWinner,
  resolveClosedPreviewSignal,
  resolveTimedOutPreviewSignal,
  waitForPreviewSignal,
} from "./client-readiness";

// Re-export lifecycle operations
export {
  createSandboxForRepo,
  getSandbox,
  createSandboxFromSnapshot,
  snapshotSandbox,
  extendSandboxTimeout,
  listVercelSandboxes,
  buildAIGatewayNetworkPolicy,
} from "./client-lifecycle";

// Re-export bootstrap context
export { resolveBootstrapContext } from "./client-bootstrap-context";

// Re-export bootstrap phases
export {
  launchDetachedDevCommand,
  runInstallPhase,
  runWorkspaceBuildPhase,
  runSelectiveRebuildPhase,
  streamCommandPhase,
  streamPreviewSignal,
  buildNoDevScriptBootstrapResult,
} from "./client-bootstrap-phases";

// Re-export bootstrap operations
export {
  bootstrapFromSnapshotStreaming,
  bootstrapFromBaselineSnapshotStreaming,
  bootstrapSandbox,
  bootstrapSandboxStreaming,
} from "./client-bootstrap";

// Re-export from sibling modules (preserve original surface)
export { BaselineSnapshotRestoreError } from "@/lib/sandbox/baseline-errors";
export {
  SandboxCreateRequestValidationError,
  type SandboxCreateRequestValidationCode,
} from "@/lib/sandbox/create-request-validation";

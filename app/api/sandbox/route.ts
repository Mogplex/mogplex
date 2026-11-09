export const maxDuration = 800;
export {
  GET,
  POST,
  createSandboxGetHandler,
  createSandboxPostHandler,
  shouldQueueSnapshotWarmupOnSandboxLaunch,
  summarizeDeferredSnapshotWarmupQueueResult,
  classifySandboxLaunchFailure,
  shouldLoadSandboxLaunchFailureDiagnostics,
  toStreamStatusSandboxRecord,
  buildSandboxInstallingRecordUpdates,
  resolvePendingSandboxPersistenceFlag,
  type CliSandboxRecord,
} from "@/lib/sandbox/collection/route";

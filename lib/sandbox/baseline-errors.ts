export type BaselineSnapshotRestorePhase =
  | "fetch"
  | "checkout"
  | "install"
  | "dev";

export class BaselineSnapshotRestoreError extends Error {
  readonly phase: BaselineSnapshotRestorePhase;
  readonly cause?: unknown;

  constructor(
    message: string,
    phase: BaselineSnapshotRestorePhase,
    cause?: unknown
  ) {
    super(message);
    this.name = "BaselineSnapshotRestoreError";
    this.phase = phase;
    this.cause = cause;
  }
}

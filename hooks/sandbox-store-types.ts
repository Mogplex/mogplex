import type { SandboxRecordPatch } from "@/lib/sandbox/client-record";
import type { SandboxError } from "@/lib/sandbox/error-state";
import type { SandboxLaunchRequestInput } from "@/lib/sandbox/launch-config";
import type { SandboxLifecycleStatus, SandboxRecord } from "@/lib/types";

export type SandboxSetState = (
  partial:
    | SandboxStore
    | Partial<SandboxStore>
    | ((state: SandboxStore) => SandboxStore | Partial<SandboxStore>)
) => void;

export type SandboxGetState = () => SandboxStore;

export type SandboxStateIndexes = Pick<
  SandboxStore,
  "sandboxes" | "sandboxesById" | "sandboxIdsByRepoId"
>;

export type SandboxStateScope = {
  sandboxId?: string | null;
  workingBranch?: string | null;
  /**
   * Omitted/undefined means the caller did not scope by root directory.
   * Branch-only read helpers fan out across matching roots; null explicitly
   * means repo root.
   */
  rootDirectory?: string | null;
};

export type SandboxLaunchAttemptOptions = {
  launchAttemptId?: string;
};

export type SandboxStore = {
  sandboxes: Record<string, SandboxRecord>;
  sandboxesById: Record<string, SandboxRecord>;
  sandboxIdsByRepoId: Record<string, string[]>;
  activeSandboxId: string | null;
  creating: Set<string>;
  creatingCounts: Record<string, number>;
  errors: Record<string, SandboxError>;
  logs: Record<string, string>;

  setActiveSandbox: (id: string | null) => void;
  setSandboxRecord: (record: SandboxRecord) => void;
  applySandboxPatch: (record: SandboxRecordPatch) => void;
  launch: (
    repoId: string,
    launchRequest?: SandboxLaunchRequestInput,
    options?: SandboxLaunchAttemptOptions
  ) => Promise<SandboxRecord | null>;
  restart: (
    repoId: string,
    options?: { sandboxId?: string | null }
  ) => Promise<SandboxRecord | null>;
  retryLaunch: (
    repoId: string,
    launchRequest?: SandboxLaunchRequestInput
  ) => Promise<SandboxRecord | null>;
  clearError: (repoId: string, scope?: SandboxStateScope) => void;
  stop: (recordId: string) => Promise<void>;
  pause: (recordId: string) => Promise<void>;
  resume: (recordId: string) => Promise<SandboxRecord | null>;
  deleteRecord: (recordId: string) => Promise<void>;
  refresh: () => Promise<boolean>;
  getSandboxForRepo: (
    repoId: string,
    options?: {
      sandboxId?: string | null;
      workingBranch?: string | null;
      rootDirectory?: string | null;
    }
  ) => SandboxRecord | null;
  listSandboxesForRepo: (repoId: string) => SandboxRecord[];
  getSandboxById: (recordId: string) => SandboxRecord | null;
  isCreating: (repoId: string, scope?: SandboxStateScope) => boolean;
  hasCreatingForRepo: (repoId: string) => boolean;
  appendLog: (repoId: string, text: string, scope?: SandboxStateScope) => void;
  getLaunchError: (
    repoId: string,
    scope?: SandboxStateScope
  ) => SandboxError | null;
  getLaunchLogs: (repoId: string, scope?: SandboxStateScope) => string;
  updateStatus: (recordId: string, status: SandboxLifecycleStatus) => void;
  extend: (recordId: string, minutes: number) => Promise<void>;
};

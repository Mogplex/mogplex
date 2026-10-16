// Provider-neutral sandbox types. Every sandbox backend (Vercel Sandbox
// today; Docker and managed microVMs later) implements `SandboxProvider`
// and returns `SandboxHandle`s, so app code never depends on one SDK.
//
// `SandboxHandle` is deliberately the structural subset of the Vercel
// `Sandbox` class that the app calls. A Vercel sandbox satisfies it as is
// (the Vercel adapter checks this at compile time), which lets callers move
// from the SDK's `Sandbox` type to these types with no runtime change. See plans/self-hosting-and-byo-compute.md (Track B).
import type { Writable } from "node:stream";
import type {
  CreateFromSnapshotOpts,
  CreateSandboxOpts,
} from "@/lib/sandbox/client-types";

export type SandboxProviderId = "vercel";

export type SandboxStatus =
  | "pending"
  | "running"
  | "stopping"
  | "stopped"
  | "failed"
  | "aborted"
  | "snapshotting";

/**
 * What a backend supports. Callers check these instead of catching
 * provider-specific errors: no `snapshots` falls back to a fresh clone, no
 * `previewUrls` hides the preview pane with a reason.
 */
export type SandboxCapabilities = {
  /** Create from and save snapshots. */
  snapshots: boolean;
  /** `domain(port)` returns a URL the browser can reach. */
  previewUrls: boolean;
  /** The session timeout can be extended while running. */
  extendTimeout: boolean;
  /** `runCommand({ detached: true })` and `getCommand(id)`. */
  detachedCommands: boolean;
  /** Stopped sandboxes keep their filesystem and resume by name. */
  persistentSandboxes: boolean;
  /**
   * Harnesses may run their own inner sandbox (Codex's bubblewrap). False
   * when the provider's container is the isolation boundary.
   */
  nestedSandbox: boolean;
};

/**
 * Per-user credentials for providers that run sandboxes in the user's own
 * account (Vercel today: the user's token, or the platform's). A provider
 * that runs on deployment-level infrastructure ignores them.
 */
export type SandboxCredentials = {
  vercelToken: string;
  vercelTeamId?: string | null;
  vercelProjectId: string;
};

type WithSignal = { signal?: AbortSignal };

export type SandboxRunCommandParams = {
  cmd: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  sudo?: boolean;
  detached?: boolean;
  stdout?: Writable;
  stderr?: Writable;
  signal?: AbortSignal;
};

export type SandboxLogLine = { data: string; stream: "stdout" | "stderr" };

/** Signals every provider must deliver to a command, or a raw number. */
export type SandboxSignal =
  | "SIGHUP"
  | "SIGINT"
  | "SIGQUIT"
  | "SIGKILL"
  | "SIGTERM"
  | "SIGCONT"
  | "SIGSTOP"
  | number;

/** A command started in a sandbox, possibly still running. */
export interface SandboxCommand {
  readonly cmdId: string;
  exitCode: number | null;
  logs: (opts?: WithSignal) => AsyncIterable<SandboxLogLine>;
  wait: (params?: WithSignal) => Promise<SandboxCommandFinished>;
  stdout: (opts?: WithSignal) => Promise<string>;
  stderr: (opts?: WithSignal) => Promise<string>;
  kill: (
    signal?: SandboxSignal,
    opts?: { abortSignal?: AbortSignal }
  ) => Promise<void>;
}

/** A command that has exited. */
export interface SandboxCommandFinished extends SandboxCommand {
  exitCode: number;
}

export type SandboxFile = { path: string; cwd?: string };

export type SandboxFileWrite = {
  path: string;
  content: string | Uint8Array;
  mode?: number;
};

/** A live handle to one sandbox. */
export interface SandboxHandle {
  readonly name: string;
  readonly status: SandboxStatus;
  readonly persistent: boolean;
  readonly currentSnapshotId: string | undefined;

  runCommand: {
    (
      command: string,
      args?: string[],
      opts?: WithSignal
    ): Promise<SandboxCommandFinished>;
    (
      params: SandboxRunCommandParams & { detached: true }
    ): Promise<SandboxCommand>;
    (params: SandboxRunCommandParams): Promise<SandboxCommandFinished>;
  };
  getCommand: (cmdId: string, opts?: WithSignal) => Promise<SandboxCommand>;

  readFile: (
    file: SandboxFile,
    opts?: WithSignal
  ) => Promise<NodeJS.ReadableStream | null>;
  readFileToBuffer: (
    file: SandboxFile,
    opts?: WithSignal
  ) => Promise<Buffer | null>;
  writeFiles: (files: SandboxFileWrite[], opts?: WithSignal) => Promise<void>;

  /** Public URL for a port. Check `capabilities.previewUrls` first. */
  domain: (port: number) => string;
  stop: (opts?: WithSignal) => Promise<unknown>;
  extendTimeout: (durationMs: number, opts?: WithSignal) => Promise<void>;
  snapshot: (
    opts?: { expiration?: number } & WithSignal
  ) => Promise<{ snapshotId: string }>;
  delete: (opts?: WithSignal) => Promise<void>;
}

/** One row of a provider's sandbox listing. */
export type SandboxSummary = {
  name: string;
  status: SandboxStatus;
  persistent: boolean;
  createdAt: number;
  tags?: Record<string, string>;
};

export type SandboxListOptions = {
  limit?: number;
  sortBy?: "createdAt" | "name" | "statusUpdatedAt";
  sortOrder?: "asc" | "desc";
  namePrefix?: string;
};

/**
 * A sandbox backend. The create options are still the Vercel-shaped launch
 * options; B2 narrows them to provider-neutral fields as callers migrate.
 */
export interface SandboxProvider {
  readonly id: SandboxProviderId;
  readonly capabilities: SandboxCapabilities;

  /** Create a sandbox from a git repository. */
  createFromGit: (opts: CreateSandboxOpts) => Promise<SandboxHandle>;
  /** Create a sandbox from a snapshot. Requires `capabilities.snapshots`. */
  createFromSnapshot: (opts: CreateFromSnapshotOpts) => Promise<SandboxHandle>;
  /**
   * Get a sandbox by name. `resume: true` wakes a stopped persistent
   * sandbox; the default leaves it stopped, for probes and teardown.
   */
  get: (
    name: string,
    credentials: SandboxCredentials,
    opts?: { resume?: boolean }
  ) => Promise<SandboxHandle>;
  /** Like `get`, but null when the provider does not know the name. */
  getIfExists: (
    name: string,
    credentials: SandboxCredentials
  ) => Promise<SandboxHandle | null>;
  list: (
    credentials: SandboxCredentials,
    opts?: SandboxListOptions
  ) => Promise<SandboxSummary[]>;
}

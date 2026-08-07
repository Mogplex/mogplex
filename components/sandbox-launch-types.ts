import type {
  SandboxLaunchOptions,
  SandboxLaunchOutcome,
  SandboxLaunchRepo,
} from "@/lib/sandbox/launch-intent";
import type { SandboxLaunchChoice } from "@/lib/sandbox/launch-config";

export type LaunchRepo = SandboxLaunchRepo;
export type LaunchOptions = SandboxLaunchOptions;
export type LaunchOutcome = SandboxLaunchOutcome;

export type SandboxLaunchContextValue = {
  launchRepoSandbox: (
    repo: LaunchRepo,
    options: LaunchOptions
  ) => Promise<LaunchOutcome>;
};

export type PendingLaunchPrompt = {
  repo: LaunchRepo;
  resolve: (choice: SandboxLaunchChoice | null) => void;
};

export type WorkspaceOption = {
  path: string;
  label: string;
  framework?: string | null;
};

export type WorkspaceFetchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; workspaces: WorkspaceOption[] }
  | { status: "error" };

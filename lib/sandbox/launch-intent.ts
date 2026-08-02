import { trackActivation } from "@/lib/activation-tracking";
import { buildDefaultSandboxLaunchChoice } from "@/lib/sandbox/launch-config";
import type {
  SandboxLaunchChoice,
  SandboxLaunchRequestInput,
} from "@/lib/sandbox/launch-config";
import {
  isSandboxUiDegraded,
  isSandboxUiPaused,
  isSandboxUiStopped,
  type SandboxUiState,
} from "@/lib/sandbox/ui-state";
import type { Repo, SandboxRecord } from "@/lib/types";

export type SandboxLaunchIntent =
  | { kind: "resume"; sandboxRecordId: string }
  | { kind: "restart_on_branch"; sandboxRecordId: string }
  | { kind: "start_fresh"; interactive?: boolean };

// Picks the right launch intent for a UI surface that already has a
// SandboxUiState in hand and an optional record id to point at. Shared
// between preview-pane and pane-content so the discriminant set stays in
// sync — no_sandbox is intentionally absent because that state has no
// record to restart from, so it falls through to start_fresh.
export function resolveSandboxLaunchIntentFromUiState(
  state: SandboxUiState,
  sandboxRecordId: string | undefined
): SandboxLaunchIntent {
  if (sandboxRecordId && isSandboxUiPaused(state)) {
    return { kind: "resume", sandboxRecordId };
  }

  if (
    sandboxRecordId &&
    (isSandboxUiStopped(state) || isSandboxUiDegraded(state))
  ) {
    return { kind: "restart_on_branch", sandboxRecordId };
  }

  return { kind: "start_fresh" };
}

export type SandboxLaunchOptions = {
  source: string;
  trigger: string;
  intent: SandboxLaunchIntent;
  launchAttemptId?: string;
  onConfirmed?: (request: SandboxLaunchRequestInput) => void;
};

export type SandboxLaunchOutcome =
  | { status: "cancelled"; sandbox: null }
  | { status: "failed"; sandbox: null }
  | { status: "launched"; sandbox: SandboxRecord };

export type SandboxLaunchRepo = Pick<
  Repo,
  | "id"
  | "full_name"
  | "default_branch"
  | "root_directory"
  | "is_monorepo"
  | "sandbox_env_vars"
  | "env_sync_mode"
  | "vercel_project_id"
>;

type SandboxLaunchIntentDeps = {
  launch: (
    repoId: string,
    request: SandboxLaunchRequestInput,
    options?: { launchAttemptId?: string }
  ) => Promise<SandboxRecord | null>;
  resumeSandbox: (recordId: string) => Promise<SandboxRecord | null>;
  getSandboxById: (recordId: string) => SandboxRecord | null;
  requestLaunchChoice: (
    repo: SandboxLaunchRepo
  ) => Promise<SandboxLaunchChoice | null>;
  track?: typeof trackActivation;
};

export async function dispatchSandboxLaunchIntent(
  repo: SandboxLaunchRepo,
  options: SandboxLaunchOptions,
  deps: SandboxLaunchIntentDeps
): Promise<SandboxLaunchOutcome> {
  const track = deps.track ?? trackActivation;

  if (options.intent.kind === "resume") {
    const record = deps.getSandboxById(options.intent.sandboxRecordId);
    if (!record) return { status: "failed", sandbox: null };

    const sandbox = await deps.resumeSandbox(options.intent.sandboxRecordId);
    if (!sandbox) return { status: "failed", sandbox: null };

    track("sandbox_resumed", {
      source: options.source,
      trigger: options.trigger,
      repo_id: repo.id,
      repo_full_name: repo.full_name,
      branch_name: record.working_branch,
    });

    return { status: "launched", sandbox };
  }

  if (options.intent.kind === "restart_on_branch") {
    const record = deps.getSandboxById(options.intent.sandboxRecordId);
    if (!record) return { status: "failed", sandbox: null };

    const request: SandboxLaunchRequestInput = {
      repoId: repo.id,
      baseBranch: record.base_branch,
      workingBranch: record.working_branch,
      rootDirectory: record.root_directory,
      createBranch: false,
    };

    options.onConfirmed?.(request);

    const sandbox = await deps.launch(repo.id, request, {
      launchAttemptId: options.launchAttemptId,
    });
    if (!sandbox) return { status: "failed", sandbox: null };

    track("sandbox_restarted_on_branch", {
      source: options.source,
      trigger: options.trigger,
      repo_id: repo.id,
      repo_full_name: repo.full_name,
      branch_name: request.workingBranch,
    });

    return { status: "launched", sandbox };
  }

  let request: SandboxLaunchRequestInput;
  if (options.intent.interactive === false) {
    request = buildDefaultSandboxLaunchChoice(repo);
  } else {
    const choice = await deps.requestLaunchChoice(repo);
    if (!choice) return { status: "cancelled", sandbox: null };
    request = { repoId: repo.id, ...choice };
  }

  options.onConfirmed?.(request);
  track("preview_started", {
    source: options.source,
    trigger: options.trigger,
    repo_id: repo.id,
    repo_full_name: repo.full_name,
    branch_mode: request.createBranch ? "new_branch" : "default_branch",
    branch_name: request.workingBranch,
  });

  const sandbox = await deps.launch(repo.id, request, {
    launchAttemptId: options.launchAttemptId,
  });
  return sandbox
    ? { status: "launched", sandbox }
    : { status: "failed", sandbox: null };
}

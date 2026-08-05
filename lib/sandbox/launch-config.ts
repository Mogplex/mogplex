import { normalizeRootDirectory } from "@/lib/repo-settings";
import type { Repo } from "@/lib/types";

export type SandboxLaunchRequestInput = {
  repoId?: string;
  baseBranch?: string | null;
  workingBranch?: string | null;
  createBranch?: boolean;
  /**
   * Optional per-launch root directory override (relative to the repo).
   *
   * - undefined  → fall back to repos.root_directory (current behaviour)
   * - null       → explicit "repo root" choice (overrides repo default)
   * - string     → relative subdirectory (e.g. "apps/web")
   *
   * Validated by isValidSandboxRootDirectory: must be a relative POSIX
   * path with no parent traversal segments.
   */
  rootDirectory?: string | null;
  restoreSnapshotId?: string | null;
  restoreSnapshotProjectId?: string | null;
  restoreSnapshotTeamId?: string | null;
};

export type ResolvedSandboxLaunchRequest = {
  repoId: string;
  baseBranch: string;
  workingBranch: string;
  createBranch: boolean;
  /**
   * - undefined → request omitted the field; caller falls back to
   *               repos.root_directory (preserves pre-existing behaviour)
   * - null      → caller explicitly chose the repo root
   * - string    → caller chose this subdirectory
   */
  rootDirectory: string | null | undefined;
  restoreSnapshotId: string | null;
  restoreSnapshotProjectId: string | null;
  restoreSnapshotTeamId: string | null;
};

export type SandboxLaunchChoice = Pick<
  ResolvedSandboxLaunchRequest,
  "baseBranch" | "workingBranch" | "createBranch"
> &
  // Optional so callers that don't show the path picker (non-monorepo
  // repos) can omit the field entirely. Spreading rootDirectory: undefined
  // would still satisfy the original Pick but silently send a null
  // override — see the omission guard in sandbox-launch-provider.tsx.
  Partial<Pick<ResolvedSandboxLaunchRequest, "rootDirectory">>;

const DEFAULT_BRANCH = "main";

function slugifyBranchSegment(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\d./_a-z-]+/g, "-")
    .replace(/\/{2,}/g, "/")
    .replace(/^-+|-+$/g, "")
    .replace(/^\/+|\/+$/g, "");
}

export function normalizeSandboxBranchName(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export const SANDBOX_LAUNCH_PATH_REPO_ROOT_VALUE = "__repo_root__";
export const SANDBOX_LAUNCH_PATH_CUSTOM_VALUE = "__custom_path__";

export type SandboxLaunchPathChoiceResult =
  | { ok: true; value: string | null | undefined }
  | { ok: false; error: string };

/**
 * Pure resolver behind the launch dialog's path dropdown. Extracted from
 * the React component so it can be unit-tested without rendering.
 *
 * Inputs:
 *   - `selection`: the dropdown value (`SANDBOX_LAUNCH_PATH_REPO_ROOT_VALUE`,
 *     `SANDBOX_LAUNCH_PATH_CUSTOM_VALUE`, or a workspace path returned by
 *     `/api/repos/[id]/monorepo`).
 *   - `customPath`: free-text input value, used only when selection is the
 *     custom-path sentinel.
 *   - `repoDefault`: `repos.root_directory`, already normalized.
 *
 * Output: the value the launch payload should carry under `rootDirectory`:
 *   - `undefined` → omit the override (server reads `repos.root_directory`)
 *   - `null`      → explicit "repo root" override
 *   - string      → relative subdirectory
 *
 * The function is self-safe against the historic edge cases mogplex
 * surfaced while iterating on this PR:
 *   - workspace paths that normalize to null (e.g. "/" or ".") are rejected
 *     rather than silently submitted as null
 *   - empty/whitespace-only custom-path inputs are rejected
 *   - "Repo root" on a repo with no persistent default is treated as
 *     "no override" (since the resulting sandboxes are identical), so a
 *     non-monorepo caller that loses its `showPathPicker` guard still
 *     produces the legacy code path.
 */
export function resolveSandboxLaunchPathChoice(
  selection: string,
  customPath: string,
  repoDefault: string | null
): SandboxLaunchPathChoiceResult {
  if (selection === SANDBOX_LAUNCH_PATH_REPO_ROOT_VALUE) {
    return { ok: true, value: repoDefault === null ? undefined : null };
  }

  if (selection === SANDBOX_LAUNCH_PATH_CUSTOM_VALUE) {
    const normalized = normalizeRootDirectory(customPath);
    if (normalized === null) {
      return {
        ok: false,
        error: "Type a path or pick 'Repo root' instead.",
      };
    }
    if (!isValidSandboxRootDirectory(normalized)) {
      return {
        ok: false,
        error:
          "Use a relative path like apps/web. No leading slash or .. segments.",
      };
    }
    return { ok: true, value: normalized };
  }

  const normalized = normalizeRootDirectory(selection);
  if (normalized === null) {
    return { ok: false, error: "Workspace path looks invalid." };
  }
  if (!isValidSandboxRootDirectory(normalized)) {
    return { ok: false, error: "Workspace path looks invalid." };
  }
  // Always return the normalized path verbatim, even when it matches the
  // current repo default. The user explicitly clicked this workspace, so
  // the sandbox should keep running at that path on resume/restart even
  // if `repos.root_directory` is later mutated. Returning `undefined`
  // would delegate the path to whatever the repo default happens to be
  // at resume time — a silent drift the user never opted into. Picking
  // "Repo root" via the sentinel option is the correct way to opt INTO
  // following the repo default.
  return { ok: true, value: normalized };
}

/**
 * Validate a launch-time root directory override.
 *
 * Allowed: empty string, ".", or a normalized relative POSIX path.
 * Rejected: absolute paths, parent-traversal segments (literal or
 * percent-encoded), NUL bytes, or any input where
 * `normalizeRootDirectory` strips into something that still contains
 * "..". This is the security boundary for path injection into the
 * shell command built by `buildShellCommand`.
 *
 * The empty-segment check is defence-in-depth: `normalizeRootDirectory`
 * already collapses runs of "/" to a single "/", so `apps//web` is
 * normalized to `apps/web` before this check runs and no empty segment
 * should survive. The check stays so this validator is independently
 * correct without relying on the normalizer's interior-slash collapse.
 *
 * Percent-encoded traversal: bash doesn't decode percent-encoding, so
 * `cd 'apps/%2e%2e/etc'` is harmless to the current shell-only callers.
 * The check below is forward-looking — if a future caller passes the
 * stored path through a filesystem or HTTP API that DOES decode percent,
 * the same validator should still reject the input.
 */
export function isValidSandboxRootDirectory(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value !== "string") return false;
  if (value.includes("\0")) return false;

  // Reject percent-encoded "." and ".." segments BEFORE normalization,
  // since normalizeRootDirectory only operates on raw characters.
  if (/(?:^|\/)%2e(?:%2e)?(?:\/|$)/i.test(value)) return false;

  const normalized = normalizeRootDirectory(value);
  if (normalized === null) return true; // empty or "." → repo root

  const segments = normalized.split("/");
  return segments.every((segment) => segment !== "" && segment !== "..");
}

export function isValidSandboxBranchName(branch: string) {
  if (!branch) return false;
  if (branch === "@" || branch === "HEAD") return false;
  if (branch.startsWith("/") || branch.endsWith("/") || branch.endsWith("."))
    return false;
  if (branch.endsWith(".lock")) return false;
  if (branch.includes("..") || branch.includes("//") || branch.includes("@{"))
    return false;
  if (/[\s*:?[\\^~]/.test(branch)) return false;
  return /^[\w./-]+$/.test(branch);
}

export function buildSuggestedSandboxBranchName(
  repoFullName: string,
  now = new Date()
) {
  const repoName =
    slugifyBranchSegment(repoFullName.split("/")[1] || "repo") || "repo";
  const isoStamp = now
    .toISOString()
    .replace(/[:-]/g, "")
    .replace(/\.\d{3}Z$/, "");
  return `mogplex/${repoName}-${isoStamp.slice(0, 15).toLowerCase()}`;
}

export function buildDefaultSandboxLaunchChoice(
  repo: Pick<Repo, "id" | "full_name" | "default_branch">,
  now = new Date()
): SandboxLaunchRequestInput {
  const defaultBranch =
    normalizeSandboxBranchName(repo.default_branch) || DEFAULT_BRANCH;
  return {
    repoId: repo.id,
    baseBranch: defaultBranch,
    workingBranch: buildSuggestedSandboxBranchName(repo.full_name, now),
    createBranch: true,
  };
}

export function resolveSandboxLaunchRequest(input: {
  body: SandboxLaunchRequestInput;
  repoDefaultBranch?: string | null;
}):
  | { ok: true; value: ResolvedSandboxLaunchRequest }
  | { ok: false; error: string } {
  const repoId =
    typeof input.body.repoId === "string" && input.body.repoId.trim()
      ? input.body.repoId.trim()
      : null;

  if (!repoId) {
    return { ok: false, error: "repoId required" };
  }

  const repoDefaultBranch =
    normalizeSandboxBranchName(input.repoDefaultBranch) || DEFAULT_BRANCH;
  const createBranch = input.body.createBranch === true;
  const baseBranch =
    normalizeSandboxBranchName(input.body.baseBranch) || repoDefaultBranch;
  const workingBranch =
    normalizeSandboxBranchName(input.body.workingBranch) ||
    (createBranch ? null : baseBranch);

  if (!isValidSandboxBranchName(baseBranch)) {
    return { ok: false, error: "Invalid base branch" };
  }

  if (!workingBranch || !isValidSandboxBranchName(workingBranch)) {
    return { ok: false, error: "Invalid working branch" };
  }

  if (createBranch && workingBranch === baseBranch) {
    return {
      ok: false,
      error: "New branch name must differ from the default branch",
    };
  }

  if (!isValidSandboxRootDirectory(input.body.rootDirectory)) {
    return { ok: false, error: "Invalid root directory" };
  }

  let resolvedRootDirectory: string | null | undefined;
  if (input.body.rootDirectory === undefined) {
    // Field omitted: fall back to repos.root_directory at the call site.
    resolvedRootDirectory = undefined;
  } else if (input.body.rootDirectory === null) {
    resolvedRootDirectory = null;
  } else {
    // String input may collapse to null after normalization (e.g. "."
    // or "/"). This is intentional and treated identically to an
    // explicit `rootDirectory: null` override — both mean "repo root".
    // Validation already accepted the input via isValidSandboxRootDirectory,
    // which also accepts null-after-normalize as the same "repo root"
    // case. See the "." → null collapse test for the contract.
    resolvedRootDirectory = normalizeRootDirectory(input.body.rootDirectory);
  }

  const restoreSnapshotId =
    typeof input.body.restoreSnapshotId === "string" &&
    input.body.restoreSnapshotId.trim()
      ? input.body.restoreSnapshotId.trim()
      : null;

  const restoreSnapshotProjectId =
    typeof input.body.restoreSnapshotProjectId === "string" &&
    input.body.restoreSnapshotProjectId.trim()
      ? input.body.restoreSnapshotProjectId.trim()
      : null;

  const restoreSnapshotTeamId =
    typeof input.body.restoreSnapshotTeamId === "string" &&
    input.body.restoreSnapshotTeamId.trim()
      ? input.body.restoreSnapshotTeamId.trim()
      : null;

  return {
    ok: true,
    value: {
      repoId,
      baseBranch,
      workingBranch,
      createBranch,
      rootDirectory: resolvedRootDirectory,
      restoreSnapshotId,
      restoreSnapshotProjectId,
      restoreSnapshotTeamId,
    },
  };
}

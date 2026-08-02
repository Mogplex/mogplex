import { normalizeRootDirectory } from "@/lib/repo-settings";
import {
  isValidSandboxBranchName,
  isValidSandboxRootDirectory,
  normalizeSandboxBranchName,
} from "@/lib/sandbox/launch-config";

/**
 * Browser-safe constants, types, and validator for sandbox launch
 * presets. Importing from this module never pulls supabaseAdmin into
 * the client bundle. The matching server-only CRUD lives in
 * `lib/launch-presets/server.ts` (which is guarded by `import "server-only"`).
 *
 * UI components and route handlers both import the shapes from here;
 * only the server CRUD module touches the database.
 */

export const SANDBOX_LAUNCH_PRESET_MAX_NAME_LENGTH = 64;
export const SANDBOX_LAUNCH_PRESET_MAX_PER_REPO = 25;

export type SandboxLaunchPreset = {
  id: string;
  user_id: string;
  repo_id: string;
  name: string;
  root_directory: string | null;
  base_branch: string;
  working_branch: string;
  create_branch: boolean;
  created_at: string;
  updated_at: string;
};

export type SandboxLaunchPresetInput = {
  name: string;
  rootDirectory: string | null;
  baseBranch: string;
  workingBranch: string;
  createBranch: boolean;
};

export class SandboxLaunchPresetValidationError extends Error {
  field: string;
  constructor(field: string, message: string) {
    super(message);
    this.name = "SandboxLaunchPresetValidationError";
    this.field = field;
  }
}

function normalizePresetName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > SANDBOX_LAUNCH_PRESET_MAX_NAME_LENGTH) {
    return trimmed.slice(0, SANDBOX_LAUNCH_PRESET_MAX_NAME_LENGTH);
  }
  return trimmed;
}

/**
 * Decides whether a save would push the user past the per-repo
 * preset cap. Pure function so it can be unit-tested without
 * mocking the DB chain. The server upsert calls this between its
 * `listSandboxLaunchPresets()` and the actual write.
 *
 * Saving a preset that overwrites an existing name (matched by
 * `existingPresetNames`) is always allowed — the cap only gates
 * the creation of a NEW name when the user is already at capacity.
 *
 * @param input.cap test-only override. Production callers should
 *   omit this and let the function pick up
 *   SANDBOX_LAUNCH_PRESET_MAX_PER_REPO. The advisory cap is
 *   intentionally not configurable per-tenant; the parameter exists
 *   only so unit tests can probe boundary behaviour without
 *   monkeypatching the global constant.
 */
export function shouldRejectAtCap(input: {
  newName: string;
  existingPresetNames: readonly string[];
  /** Test-only override; see JSDoc above. */
  cap?: number;
}): boolean {
  const cap = input.cap ?? SANDBOX_LAUNCH_PRESET_MAX_PER_REPO;
  const overwrite = input.existingPresetNames.includes(input.newName);
  return !overwrite && input.existingPresetNames.length >= cap;
}

/**
 * Validates and normalizes a SandboxLaunchPresetInput. Reuses the
 * existing launch-config validators so a preset can never represent a
 * combination the live launch dialog would reject.
 *
 * Lives in this browser-safe module so the launch dialog can run the
 * same validation client-side before the network round-trip.
 */
export function normalizeSandboxLaunchPresetInput(
  raw: unknown
): SandboxLaunchPresetInput {
  const input = raw as Partial<SandboxLaunchPresetInput> | null;
  if (!input || typeof input !== "object") {
    throw new SandboxLaunchPresetValidationError(
      "name",
      "Preset payload required"
    );
  }

  const name = normalizePresetName(input.name);
  if (!name) {
    throw new SandboxLaunchPresetValidationError(
      "name",
      "Preset name is required"
    );
  }

  const baseBranch = normalizeSandboxBranchName(input.baseBranch);
  if (!baseBranch || !isValidSandboxBranchName(baseBranch)) {
    throw new SandboxLaunchPresetValidationError(
      "baseBranch",
      "Invalid base branch"
    );
  }

  const workingBranch = normalizeSandboxBranchName(input.workingBranch);
  if (!workingBranch || !isValidSandboxBranchName(workingBranch)) {
    throw new SandboxLaunchPresetValidationError(
      "workingBranch",
      "Invalid working branch"
    );
  }

  const createBranch = Boolean(input.createBranch);
  if (createBranch && workingBranch === baseBranch) {
    throw new SandboxLaunchPresetValidationError(
      "workingBranch",
      "New-branch presets must use a working branch different from base"
    );
  }

  // root_directory accepts the same three-way semantics as the launch
  // request, but presets persist in the DB so we collapse "undefined"
  // to "null" (= explicit repo root) at save time. Users who want
  // "follow the repo default at apply time" don't save a preset — they
  // just use the dialog's regular flow.
  if (!isValidSandboxRootDirectory(input.rootDirectory)) {
    throw new SandboxLaunchPresetValidationError(
      "rootDirectory",
      "Invalid root directory"
    );
  }
  const rootDirectory =
    input.rootDirectory === null || input.rootDirectory === undefined
      ? null
      : normalizeRootDirectory(input.rootDirectory);

  return {
    name,
    rootDirectory,
    baseBranch,
    workingBranch,
    createBranch,
  };
}

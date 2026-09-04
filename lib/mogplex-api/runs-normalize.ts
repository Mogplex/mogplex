/**
 * Request normalization and validation for external agent runs.
 *
 * This module handles input validation, branch/path normalization, and request
 * hashing for the external Mogplex API. Separating normalization from business
 * logic keeps runs.ts focused on orchestration.
 */
import { createHash } from "node:crypto";
import { normalizeRootDirectory } from "@/lib/repo-settings";
import {
  isValidSandboxBranchName,
  isValidSandboxRootDirectory,
} from "@/lib/sandbox/launch-config";
import type { ApiKeyAuth } from "@/lib/auth/api-key";
import {
  MogplexApiRunError,
  MOGPLEX_API_RUN_HARNESSES,
  type MogplexApiRunHarness,
  type StartMogplexApiRunRequest,
} from "./runs-types";

const DEFAULT_BRANCH = "main";
const MAX_PROMPT_LENGTH = 100_000;

type OwnedRepoForRun = {
  id: string;
  full_name: string;
  default_branch: string | null;
  root_directory: string | null;
};

type ActiveSandboxForRun = {
  id: string;
  sandbox_id: string | null;
};

export type NormalizedStartRequest = {
  repoId: string;
  prompt: string;
  harness: MogplexApiRunHarness;
  baseBranch: string;
  workingBranch: string;
  createBranch: boolean;
  rootDirectory: string | null;
  conversationId: string | null;
  workspaceSessionId: string | null;
  mode: string | null;
  worktreeId: string | null;
};

export function normalizeOptionalString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function assertValidHarness(value: unknown): MogplexApiRunHarness {
  const harness = normalizeOptionalString(value) ?? "codex";
  if (MOGPLEX_API_RUN_HARNESSES.includes(harness as MogplexApiRunHarness)) {
    return harness as MogplexApiRunHarness;
  }
  throw new MogplexApiRunError("BAD_REQUEST", "Invalid harness", 400);
}

export function normalizeRunRootDirectory(
  inputValue: unknown,
  repoRootDirectory: string | null
) {
  if (inputValue === undefined) return repoRootDirectory;
  if (inputValue === null) return null;
  if (typeof inputValue !== "string") {
    throw new MogplexApiRunError("BAD_REQUEST", "Invalid root directory", 400);
  }
  if (!isValidSandboxRootDirectory(inputValue)) {
    throw new MogplexApiRunError("BAD_REQUEST", "Invalid root directory", 400);
  }

  return normalizeRootDirectory(inputValue);
}

export function validateBranch(name: string, label: string) {
  if (!isValidSandboxBranchName(name)) {
    throw new MogplexApiRunError("BAD_REQUEST", `Invalid ${label}`, 400);
  }
}

export function buildGeneratedWorkingBranch(
  idempotencyKey: string,
  requestHash: string
) {
  const keyHash = createHash("sha256").update(idempotencyKey).digest("hex");
  return `mogplex/external/${keyHash.slice(0, 8)}-${requestHash.slice(0, 8)}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

export function hashRequest(value: unknown) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function normalizeStartRequest(input: {
  body: StartMogplexApiRunRequest;
  repo: OwnedRepoForRun;
  idempotencyKey: string;
}) {
  const repoId = normalizeOptionalString(input.body.repoId);
  if (!repoId) {
    throw new MogplexApiRunError("BAD_REQUEST", "repoId is required", 400);
  }

  const prompt = normalizeOptionalString(input.body.prompt);
  if (!prompt) {
    throw new MogplexApiRunError("BAD_REQUEST", "Prompt is required", 400);
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    throw new MogplexApiRunError("BAD_REQUEST", "Prompt is too long", 400);
  }

  const harness = assertValidHarness(input.body.harness);
  const baseBranch =
    normalizeOptionalString(input.body.baseBranch) ??
    normalizeOptionalString(input.repo.default_branch) ??
    DEFAULT_BRANCH;
  validateBranch(baseBranch, "base branch");

  const createBranch = input.body.createBranch === true;
  const preliminary = {
    repoId,
    prompt,
    harness,
    baseBranch,
    createBranch,
    rootDirectory: normalizeRunRootDirectory(
      input.body.rootDirectory,
      input.repo.root_directory
    ),
    conversationId: normalizeOptionalString(input.body.conversationId),
    workspaceSessionId: normalizeOptionalString(input.body.workspaceSessionId),
    mode: normalizeOptionalString(input.body.mode),
    worktreeId: normalizeOptionalString(input.body.worktreeId),
  };
  // The generated branch is derived from the pre-branch logical request, then
  // included in the persisted request hash. Retrying the same request with the
  // same idempotency key deterministically produces the same branch and hash.
  const requestHash = hashRequest(preliminary);
  const workingBranch =
    normalizeOptionalString(input.body.workingBranch) ??
    (createBranch
      ? buildGeneratedWorkingBranch(input.idempotencyKey, requestHash)
      : baseBranch);
  validateBranch(workingBranch, "working branch");

  if (createBranch && workingBranch === baseBranch) {
    throw new MogplexApiRunError(
      "BAD_REQUEST",
      "Working branch must differ from base branch when createBranch is true",
      400
    );
  }

  const normalized: NormalizedStartRequest = {
    ...preliminary,
    workingBranch,
  };

  return {
    normalized,
    requestHash: hashRequest(normalized),
  };
}

export function buildRunMetadata(input: {
  normalized: NormalizedStartRequest;
  idempotencyKey: string;
  requestHash: string;
  repo: OwnedRepoForRun;
  sandbox: ActiveSandboxForRun | null;
  apiKey: Pick<ApiKeyAuth, "keyId" | "scopes">;
  /**
   * Where the run was triggered from — "slack", "api", "mcp", "cli". Recorded
   * as `run_origin` for display. Distinct from `source`, which the harness
   * route reuses as a claim marker and must stay "external-api".
   */
  origin?: string;
  /** Caller-supplied extras (e.g. Slack message coords). Core fields below
   *  always win — a caller can't clobber `source`, `request_hash`, etc. */
  extraMetadata?: Record<string, unknown>;
}) {
  return {
    ...input.extraMetadata,
    source: "external-api",
    run_origin: input.origin ?? "api",
    external_request_id: input.idempotencyKey,
    request_hash: input.requestHash,
    api_key_id: input.apiKey.keyId,
    api_key_scopes: input.apiKey.scopes,
    harness_id: input.normalized.harness,
    repo_id: input.normalized.repoId,
    repo: input.repo.full_name,
    base_branch: input.normalized.baseBranch,
    working_branch: input.normalized.workingBranch,
    root_directory: input.normalized.rootDirectory,
    sandbox_record_id: input.sandbox?.id ?? null,
    sandbox_id: input.sandbox?.sandbox_id ?? null,
    worktree_id: input.normalized.worktreeId,
  };
}

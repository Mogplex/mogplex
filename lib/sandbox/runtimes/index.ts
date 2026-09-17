import { nodeStrategy, node24Strategy } from "./node";
import { pythonStrategy } from "./python";
import type { Sandbox } from "@vercel/sandbox";
import type { RuntimeStrategy, SandboxRuntime, DetectionResult } from "./types";
import { githubRepositoryFiles } from "../repository-files";
import { detectNodeRuntimeFromFiles } from "./node-version";
import { resolveMonorepoWebTargetFromFiles } from "./node-monorepo";

export {
  SUPPORTED_RUNTIMES,
  RUNTIME_LABELS,
  type RuntimeStrategy,
  type SandboxRuntime,
  type DetectionResult,
} from "./types";

/** Registry of all supported runtime strategies. */
const STRATEGIES: Record<SandboxRuntime, RuntimeStrategy> = {
  node22: nodeStrategy,
  node24: node24Strategy,
  "python3.13": pythonStrategy,
};

/** Get the strategy for a given runtime. Defaults to node22. */
export function getStrategy(runtime?: SandboxRuntime | null): RuntimeStrategy {
  return STRATEGIES[runtime || "node22"] || STRATEGIES.node22;
}

/**
 * Auto-detect runtime by inspecting sandbox files.
 * Tries each strategy's detect() in priority order.
 * Falls back to node22 if nothing matches.
 */
export async function detectRuntime(
  sandbox: Sandbox,
  rootDir?: string | null
): Promise<DetectionResult> {
  // The VM runtime was selected before creation; detect package tooling here.
  const order: RuntimeStrategy[] = [nodeStrategy, pythonStrategy];

  for (const strategy of order) {
    const result = await strategy.detect(sandbox, rootDir);
    if (result) return result;
  }

  // Default fallback
  return { runtime: "node22", packageManager: "npm" };
}

/**
 * Pre-detect runtime via GitHub API before creating the sandbox VM.
 * Checks for key project files to determine runtime.
 * Respects root_directory for monorepos.
 */
export async function detectRuntimeFromGithub(
  repoFullName: string,
  githubToken: string,
  branch?: string,
  rootDirectory?: string | null
): Promise<SandboxRuntime> {
  const files = githubRepositoryFiles({
    repoFullName,
    githubToken,
    ref: branch || "main",
  });
  const prefix = rootDirectory ? `${rootDirectory.replace(/\/$/, "")}/` : "";
  const [pkg, requirements, pyproject] = await Promise.all([
    files.readText(`${prefix}package.json`),
    files.readText(`${prefix}requirements.txt`),
    files.readText(`${prefix}pyproject.toml`),
  ]);

  // If both exist, prefer Node (user can override in settings)
  if (pkg !== null) {
    const autoTarget = rootDirectory
      ? null
      : await resolveMonorepoWebTargetFromFiles(files);
    return detectNodeRuntimeFromFiles(files, autoTarget?.path ?? rootDirectory);
  }
  if (requirements !== null || pyproject !== null) return "python3.13";

  return "node22";
}

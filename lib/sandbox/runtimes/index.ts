import { nodeStrategy, node24Strategy } from "./node";
import { pythonStrategy } from "./python";
import type { Sandbox } from "@vercel/sandbox";
import type { RuntimeStrategy, SandboxRuntime, DetectionResult } from "./types";

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
  // node22 is the default for Node projects; node24 requires explicit opt-in via repo settings
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
  const ref = branch || "main";
  const prefix = rootDirectory ? `${rootDirectory}/` : "";

  const fileExists = async (path: string): Promise<boolean> => {
    try {
      const res = await fetch(
        `https://api.github.com/repos/${repoFullName}/contents/${prefix}${path}?ref=${ref}`,
        {
          method: "HEAD",
          headers: {
            Authorization: `Bearer ${githubToken}`,
            Accept: "application/vnd.github.v3+json",
          },
        }
      );
      return res.ok;
    } catch {
      return false;
    }
  };

  const [hasPackageJson, hasRequirements, hasPyproject] = await Promise.all([
    fileExists("package.json"),
    fileExists("requirements.txt"),
    fileExists("pyproject.toml"),
  ]);

  // If both exist, prefer Node (user can override in settings)
  if (hasPackageJson) return "node22";
  if (hasRequirements || hasPyproject) return "python3.13";

  return "node22";
}

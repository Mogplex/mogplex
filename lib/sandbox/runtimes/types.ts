import type { Sandbox } from "@vercel/sandbox";

export type SandboxRuntime = "node22" | "node24" | "python3.13";

export const SUPPORTED_RUNTIMES: readonly SandboxRuntime[] = [
  "node22",
  "node24",
  "python3.13",
] as const;

export type DetectionResult = {
  runtime: SandboxRuntime;
  packageManager: string;
  framework?: string;
  /** Resolved entrypoint module for frameworks like FastAPI (e.g. "app.main"). */
  frameworkEntry?: string;
  /** True when lockfile lives at repo root, not in rootDirectory subdirectory */
  installFromRoot?: boolean;
};

export type RuntimeStrategy = {
  id: SandboxRuntime;
  name: string;
  defaultPort: number;
  /** Check sandbox files to detect this runtime. Returns null if not a match. */
  detect: (
    sandbox: Sandbox,
    rootDir?: string | null
  ) => Promise<DetectionResult | null>;
  /** Build the dependency install command. */
  buildInstallCommand: (pm: string) => string;
  /** Build the dev server launch command. */
  buildDevCommand: (
    pm: string,
    framework?: string,
    frameworkEntry?: string,
    packageDevScript?: string | null
  ) => string;
  /** Additional ports to expose besides the dev port (e.g. common framework defaults). */
  defaultPorts: number[];
  /** Deps to selectively rebuild after --ignore-scripts install (Node only). */
  rebuildTargets?: string[];
  /**
   * Build the command that compiles workspace dependencies (those declared
   * with `workspace:*` protocol). Called after install, before dev starts, so
   * downstream imports like `main: "dist/index.js"` resolve in a fresh clone.
   * Returns null when the package manager or project doesn't need this step.
   */
  buildWorkspaceDepsBuildCommand?: (
    pm: string,
    packageName: string
  ) => string | null;
  /** Patch config files for sandbox compatibility (e.g. Vite host injection). */
  patchConfig?: (
    sandbox: Sandbox,
    framework: string | undefined,
    rootDir?: string | null
  ) => Promise<void>;
};

export const RUNTIME_LABELS: Record<SandboxRuntime, string> = {
  node22: "Node.js 22",
  node24: "Node.js 24",
  "python3.13": "Python 3.13",
};

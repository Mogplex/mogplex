import type { Sandbox } from "@vercel/sandbox";
import { resolvePackageDevPort } from "./package-dev-port";
import { sandboxRepositoryFiles } from "./repository-files";
import {
  DEFAULT_ENV_SYNC_MODE,
  buildRuntimeSandboxEnv,
  normalizeRootDirectory,
  resolveSandboxPath,
} from "@/lib/repo-settings";
import { prepareSandboxVercelLink } from "@/lib/vercel/env-vars";
import { detectRuntime, getStrategy } from "@/lib/sandbox/runtimes";
import { isNodeRuntime } from "@/lib/sandbox/runtimes/types";
import {
  detectWorkspaceDependencies,
  resolveMonorepoWebTarget,
} from "@/lib/sandbox/runtimes/node";
import type {
  BootstrapSandboxOpts,
  BootstrapDetection,
  BootstrapStrategy,
  ResolvedBootstrapContext,
  SandboxRuntime,
} from "./client-types";
import {
  resolveDevPort,
  resolveBootstrapInstallCommand,
  resolveBootstrapDevCommand,
  buildDetectBunUsageScript,
  commandRequiresBun,
} from "./client-shell";
import { buildPreviewReadinessOptions } from "./client-readiness";

export async function resolveBootstrapDetection(
  sandbox: Sandbox,
  normalizedRoot: string | null,
  runtimeOverride?: SandboxRuntime | null
): Promise<{
  effectiveRuntime: SandboxRuntime;
  strategy: BootstrapStrategy;
  effectiveDetection: BootstrapDetection;
}> {
  const detection = await detectRuntime(sandbox, normalizedRoot);
  const effectiveRuntime: SandboxRuntime = runtimeOverride || detection.runtime;
  const strategy = getStrategy(effectiveRuntime);
  const effectiveDetection =
    runtimeOverride && runtimeOverride !== detection.runtime
      ? (await strategy.detect(sandbox, normalizedRoot)) || detection
      : detection;

  return {
    effectiveRuntime,
    strategy,
    effectiveDetection,
  };
}

/**
 * Read the dev script from package.json. A missing file reports no dev
 * script and no manifest; an empty, unreadable or malformed one counts as
 * present with a dev script, so the npm path runs and fails loudly.
 */
export async function readPackageDevScriptInfo(
  sandbox: Sandbox,
  normalizedRoot: string | null
) {
  try {
    const pkgPath = resolveSandboxPath(normalizedRoot, "package.json");
    const buffer = await sandbox.readFileToBuffer({ path: pkgPath });
    if (!buffer) {
      return {
        packageDevScript: null,
        hasDevScript: false,
        hasPackageJson: false,
      };
    }

    const pkg = JSON.parse(buffer.toString("utf-8")) as {
      scripts?: Record<string, string>;
    };
    const packageDevScript =
      typeof pkg.scripts?.dev === "string" ? pkg.scripts.dev.trim() : null;

    return {
      packageDevScript,
      hasDevScript: Boolean(packageDevScript),
      hasPackageJson: true,
    };
  } catch (error) {
    // Unreadable or malformed package.json: keep the npm path so the dev
    // server's own error surfaces, but say why the empty-repo skip didn't apply.
    console.warn(
      "[sandbox/bootstrap] could not read package.json dev script:",
      error instanceof Error ? error.message : error
    );
    return {
      packageDevScript: null,
      hasDevScript: true,
      hasPackageJson: true,
    };
  }
}

async function patchBootstrapConfigIfNeeded(
  sandbox: Sandbox,
  strategy: BootstrapStrategy,
  framework: BootstrapDetection["framework"],
  normalizedRoot: string | null,
  hasDevCommandOverride: boolean
) {
  if (strategy.patchConfig && !hasDevCommandOverride) {
    await strategy.patchConfig(sandbox, framework, normalizedRoot);
  }
}

function resolveInstallDir(
  detection: BootstrapDetection,
  normalizedRoot: string | null
) {
  return detection.installFromRoot ? null : normalizedRoot;
}

/**
 * If the target package depends on workspace:* packages that need to be
 * compiled (e.g. a `@credit-renew/shared` package whose `main` points at
 * `dist/index.js`), returns a command that builds those deps. Returns null
 * when there are no workspace deps or the package manager doesn't support
 * filtered workspace builds.
 */
async function resolveWorkspaceBuildCommand(
  sandbox: Sandbox,
  normalizedRoot: string | null,
  strategy: BootstrapStrategy,
  packageManager: BootstrapDetection["packageManager"]
): Promise<string | null> {
  if (!strategy.buildWorkspaceDepsBuildCommand) return null;
  const { packageName, hasWorkspaceDeps } = await detectWorkspaceDependencies(
    sandbox,
    normalizedRoot
  );
  if (!hasWorkspaceDeps || !packageName) return null;
  return strategy.buildWorkspaceDepsBuildCommand(packageManager, packageName);
}

/**
 * Probe the checkout for bun usage the resolved commands can't reveal —
 * nested workspace scripts (e.g. `packages/tui`'s `"dev": "bun run …"` run
 * through a root `pnpm --filter` command), bun lockfiles, or a
 * `packageManager: "bun@…"` field. Runs from the sandbox repo root; any
 * probe failure conservatively reports no bun usage.
 */
async function detectSandboxBunUsage(sandbox: Sandbox): Promise<boolean> {
  try {
    const command = await sandbox.runCommand({
      cmd: "node",
      args: ["-e", buildDetectBunUsageScript()],
    });
    const stdout = await command.stdout();
    return stdout.trim() === "1";
  } catch {
    return false;
  }
}

export async function resolveBootstrapContext(
  sandbox: Sandbox,
  opts: BootstrapSandboxOpts
): Promise<ResolvedBootstrapContext> {
  const userRoot = normalizeRootDirectory(opts.rootDirectory);
  // Auto-redirect to a web-app workspace when the caller didn't pin a
  // rootDirectory and the repo root isn't itself a web app (e.g.
  // credit-renew's root is an Apify actor but `web/` is a Next.js app).
  const autoTarget = userRoot ? null : await resolveMonorepoWebTarget(sandbox);
  const normalizedRoot = autoTarget?.path
    ? normalizeRootDirectory(autoTarget.path)
    : userRoot;
  const monorepoAutoTargetMessage = autoTarget
    ? `Auto-selected monorepo preview target: ${autoTarget.path}` +
      (autoTarget.framework ? ` (${autoTarget.framework})` : "") +
      ". Set a root directory in repo settings to override."
    : null;
  const { effectiveRuntime, strategy, effectiveDetection } =
    await resolveBootstrapDetection(sandbox, normalizedRoot, opts.runtime);
  const { packageManager, framework, frameworkEntry } = effectiveDetection;
  const packageInfo = await readPackageDevScriptInfo(sandbox, normalizedRoot);
  const { packageDevScript } = packageInfo;
  // A README-only Node repo has nothing to install or start; running the
  // default `npm install` there writes a stray lockfile and `npm run dev`
  // exits, failing the whole boot before the agent can scaffold anything.
  // Install and dev are separate decisions: a configured install command
  // still runs, and a configured dev command always starts.
  const nodeWithoutPackageJson =
    !packageInfo.hasPackageJson && isNodeRuntime(effectiveRuntime);
  const skipDefaultInstall = nodeWithoutPackageJson && !opts.installCommand;
  // A Python repo without package.json keeps its strategy's dev command.
  const hasDevScript =
    Boolean(opts.devCommand) ||
    (packageInfo.hasPackageJson
      ? packageInfo.hasDevScript
      : !isNodeRuntime(effectiveRuntime));
  const emptyNodeProject = skipDefaultInstall && !hasDevScript;
  const workspaceBuildCommand = await resolveWorkspaceBuildCommand(
    sandbox,
    normalizedRoot,
    strategy,
    packageManager
  );
  const readiness = buildPreviewReadinessOptions({
    runtime: effectiveRuntime,
    framework,
  });
  const pinnedPort =
    opts.devPort ??
    (await resolvePackageDevPort(sandboxRepositoryFiles(sandbox), {
      rootDirectory: normalizedRoot,
      devCommand: opts.devCommand,
    }));
  const devPort = resolveDevPort(pinnedPort, framework, strategy);
  const previewUrl = sandbox.domain(devPort);
  const runtimeEnv = buildRuntimeSandboxEnv(
    opts.envVars,
    opts.envSyncMode ?? DEFAULT_ENV_SYNC_MODE,
    previewUrl
  );
  const devLogPath = resolveSandboxPath(normalizedRoot, ".mogplex/dev.log");
  const preparedVercelLink = await prepareSandboxVercelLink(sandbox, {
    rootDirectory: normalizedRoot,
    envSyncMode: opts.envSyncMode,
    envVars: runtimeEnv,
    linkedProject: opts.linkedVercelProject,
  });

  await patchBootstrapConfigIfNeeded(
    sandbox,
    strategy,
    framework,
    normalizedRoot,
    Boolean(opts.devCommand)
  );

  const installCommand = resolveBootstrapInstallCommand(
    opts.installCommand,
    strategy,
    packageManager
  );
  const devCommand = resolveBootstrapDevCommand(
    opts.devCommand,
    strategy,
    packageManager,
    framework,
    frameworkEntry,
    packageDevScript
  );
  const requiresBun =
    packageManager === "bun" ||
    commandRequiresBun(installCommand) ||
    commandRequiresBun(devCommand) ||
    (await detectSandboxBunUsage(sandbox));

  return {
    normalizedRoot,
    effectiveRuntime,
    strategy,
    effectiveDetection,
    packageManager,
    framework,
    frameworkEntry,
    packageDevScript,
    hasDevScript,
    emptyNodeProject,
    skipDefaultInstall,
    nodeWithoutPackageJson,
    readiness,
    previewUrl,
    runtimeEnv,
    devLogPath,
    requiresBun,
    installCommand,
    devCommand,
    installDir: resolveInstallDir(effectiveDetection, normalizedRoot),
    workspaceBuildCommand,
    vercelLinkWarning: preparedVercelLink.warning ?? null,
    monorepoAutoTargetMessage,
  };
}

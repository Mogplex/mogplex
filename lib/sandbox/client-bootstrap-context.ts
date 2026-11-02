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
import { detectProjectRuntime, getStrategy } from "@/lib/sandbox/runtimes";
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
  hasProjectManifest: boolean;
}> {
  const detection = await detectProjectRuntime(sandbox, normalizedRoot);
  const effectiveRuntime: SandboxRuntime =
    runtimeOverride || detection?.runtime || "node22";
  const strategy = getStrategy(effectiveRuntime);
  // The manifest that counts is the one the effective runtime understands:
  // a package.json does not give a Python sandbox anything to pip install.
  const runtimeDetection =
    runtimeOverride && runtimeOverride !== detection?.runtime
      ? await strategy.detect(sandbox, normalizedRoot)
      : detection;
  const effectiveDetection = runtimeDetection ??
    detection ?? { runtime: "node22", packageManager: "npm" };

  return {
    effectiveRuntime,
    strategy,
    effectiveDetection,
    hasProjectManifest: runtimeDetection !== null,
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
  const { effectiveRuntime, strategy, effectiveDetection, hasProjectManifest } =
    await resolveBootstrapDetection(sandbox, normalizedRoot, opts.runtime);
  const { packageManager, framework, frameworkEntry } = effectiveDetection;
  const packageInfo = await readPackageDevScriptInfo(sandbox, normalizedRoot);
  const { packageDevScript } = packageInfo;
  // A repo no runtime strategy recognizes (README-only, Go, Rust, a static
  // site, ...) has nothing the default install understands: `npm install`
  // writes a stray lockfile and `pip install -r requirements.txt` exits, and
  // either failure would end the boot before the agent can set anything up.
  // Install and dev are separate decisions: a configured install command
  // still runs, and a configured dev command always starts.
  const noProjectManifest = !hasProjectManifest;
  const skipDefaultInstall = noProjectManifest && !opts.installCommand;
  // Node starts the package.json dev script; other runtimes start their
  // strategy's command when they recognized the project.
  const startsDevServer =
    Boolean(opts.devCommand) ||
    (isNodeRuntime(effectiveRuntime)
      ? packageInfo.hasDevScript
      : hasProjectManifest);
  const emptyProject = skipDefaultInstall && !startsDevServer;
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
    startsDevServer,
    emptyProject,
    skipDefaultInstall,
    noProjectManifest,
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

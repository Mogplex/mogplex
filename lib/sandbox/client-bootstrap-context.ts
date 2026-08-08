import type { Sandbox } from "@vercel/sandbox";
import {
  DEFAULT_ENV_SYNC_MODE,
  buildRuntimeSandboxEnv,
  normalizeRootDirectory,
  resolveSandboxPath,
} from "@/lib/repo-settings";
import { prepareSandboxVercelLink } from "@/lib/vercel/env-vars";
import { detectRuntime, getStrategy } from "@/lib/sandbox/runtimes";
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
import {
  buildPreviewReadinessOptions,
  readSandboxTextFile,
} from "./client-readiness";

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

export async function readPackageDevScriptInfo(
  sandbox: Sandbox,
  normalizedRoot: string | null
) {
  try {
    const pkgPath = resolveSandboxPath(normalizedRoot, "package.json");
    const pkgText = await readSandboxTextFile(sandbox, pkgPath);
    if (!pkgText) {
      return {
        packageDevScript: null,
        hasDevScript: true,
      };
    }

    const pkg = JSON.parse(pkgText) as { scripts?: Record<string, string> };
    const packageDevScript =
      typeof pkg.scripts?.dev === "string" ? pkg.scripts.dev.trim() : null;

    return {
      packageDevScript,
      hasDevScript: Boolean(packageDevScript),
    };
  } catch {
    return {
      packageDevScript: null,
      hasDevScript: true,
    };
  }
}

function resolveBootstrapPortHints(
  packageDevScript: string | null,
  config: {
    extraPortHints?: Array<string | null | undefined>;
    includePackageDevScriptForPort?: boolean;
  }
) {
  return [
    ...(config.extraPortHints ?? []),
    config.includePackageDevScriptForPort === false ? null : packageDevScript,
  ];
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
  opts: BootstrapSandboxOpts,
  config: {
    extraPortHints?: Array<string | null | undefined>;
    includePackageDevScriptForPort?: boolean;
  } = {}
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
  const { packageDevScript, hasDevScript } = await readPackageDevScriptInfo(
    sandbox,
    normalizedRoot
  );
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
  const devPort = resolveDevPort(
    opts.devPort,
    framework,
    strategy,
    ...resolveBootstrapPortHints(packageDevScript, config)
  );
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

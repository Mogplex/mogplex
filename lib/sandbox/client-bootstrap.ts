import type { Sandbox } from "@vercel/sandbox";
import type { SandboxBootstrapStreamEvent } from "@/lib/sandbox/events";
import type { BootstrapSandboxOpts } from "./client-types";
import { SandboxBootstrapError } from "./client-validation";
import {
  buildShellCommand,
  buildSelectiveRebuildCommand,
} from "./client-shell";
import {
  NO_DEV_SCRIPT_MESSAGE,
  waitForPreviewSignal,
} from "./client-readiness";
import { resolveBootstrapContext } from "./client-bootstrap-context";
import {
  launchDetachedDevCommand,
  runInstallPhase,
  runWorkspaceBuildPhase,
  runSelectiveRebuildPhase,
  streamCommandPhase,
  streamPreviewSignal,
  buildNoDevScriptBootstrapResult,
} from "./client-bootstrap-phases";

// Re-export baseline bootstrap from its module
export { bootstrapFromBaselineSnapshotStreaming } from "./client-bootstrap-baseline";

/**
 * Lighter bootstrap for snapshot-restored sandboxes.
 * Deps are already installed — only starts the dev server.
 */
export async function* bootstrapFromSnapshotStreaming(
  sandbox: Sandbox,
  opts: BootstrapSandboxOpts = {}
): AsyncGenerator<SandboxBootstrapStreamEvent> {
  const context = await resolveBootstrapContext(sandbox, opts, {
    extraPortHints: [opts.devCommand],
  });
  if (context.monorepoAutoTargetMessage) {
    yield { type: "warning", message: context.monorepoAutoTargetMessage };
  }
  if (context.vercelLinkWarning) {
    yield { type: "warning", message: context.vercelLinkWarning };
  }

  // Skip install — deps are already in the snapshot

  if (!context.hasDevScript) {
    yield {
      type: "log",
      phase: "dev",
      data: "Snapshot restored — no dev script found. Ready for terminal and file access.\n",
    };
    yield { type: "preview_url", url: context.previewUrl };
    yield { type: "status", status: "running" };
    return;
  }

  // Start dev server
  const devLaunch = await launchDetachedDevCommand(
    sandbox,
    context.normalizedRoot,
    context.devCommand,
    context.runtimeEnv
  );

  yield { type: "preview_url", url: context.previewUrl };
  yield* streamPreviewSignal(
    sandbox,
    devLaunch,
    context.previewUrl,
    context.devLogPath,
    context.readiness
  );

  yield { type: "status", status: "running" };
}

/**
 * Auto-install deps and start dev server. Returns preview URL.
 * Delegates to the matched RuntimeStrategy for detection, install, and dev commands.
 */
export async function bootstrapSandbox(
  sandbox: Sandbox,
  opts: BootstrapSandboxOpts = {}
) {
  const context = await resolveBootstrapContext(sandbox, opts, {
    extraPortHints: [opts.devCommand],
  });

  if (context.monorepoAutoTargetMessage) {
    console.info("[sandbox/bootstrap]", context.monorepoAutoTargetMessage);
  }
  if (context.vercelLinkWarning) {
    console.warn("[sandbox/bootstrap]", context.vercelLinkWarning);
  }

  const installLog = await runInstallPhase(
    sandbox,
    context.installCommand,
    context.installDir,
    context.runtimeEnv,
    context.previewUrl
  );
  await runWorkspaceBuildPhase(
    sandbox,
    context.workspaceBuildCommand,
    context.runtimeEnv
  );
  await runSelectiveRebuildPhase(
    sandbox,
    context,
    Boolean(opts.installCommand)
  );

  // If no dev script, skip dev server — sandbox is usable for terminal/files/editor
  if (!context.hasDevScript) {
    return buildNoDevScriptBootstrapResult(context, installLog);
  }

  // Start dev server in background (with timeout)
  const devLaunch = await launchDetachedDevCommand(
    sandbox,
    context.normalizedRoot,
    context.devCommand,
    context.runtimeEnv,
    `Dev server launch (${context.devCommand})`
  );
  const previewReadiness = await waitForPreviewSignal(
    sandbox,
    devLaunch,
    context.previewUrl,
    context.devLogPath,
    {
      readiness: context.readiness,
    }
  );
  const { devLog } = previewReadiness;

  return {
    previewUrl: context.previewUrl,
    runtime: context.effectiveRuntime,
    packageManager: context.packageManager,
    framework: context.framework,
    installCommand: context.installCommand,
    devCommand: context.devCommand,
    installLog,
    devLog,
    healthStatus: previewReadiness.healthStatus,
    readiness: previewReadiness,
  };
}

/**
 * Streaming variant of bootstrapSandbox. Uses `detached: true` + `command.logs()`
 * to yield real-time log output as SandboxEvents instead of blocking until completion.
 *
 * The existing `bootstrapSandbox()` is kept for backward compat (workflows/cron).
 */
export async function* bootstrapSandboxStreaming(
  sandbox: Sandbox,
  opts: BootstrapSandboxOpts = {}
): AsyncGenerator<SandboxBootstrapStreamEvent> {
  // packageDevScript must participate in port resolution — for monorepos
  // where `apps/web/package.json` pins the port via "next dev -p 3003",
  // ignoring it made us route the preview to 3000 while the server bound
  // somewhere else. Also forward the user's devCommand (if any) so an
  // explicit --port in repo settings wins over package.json.
  const context = await resolveBootstrapContext(sandbox, opts, {
    extraPortHints: [opts.devCommand],
  });
  if (context.monorepoAutoTargetMessage) {
    yield { type: "warning", message: context.monorepoAutoTargetMessage };
  }
  if (context.vercelLinkWarning) {
    yield { type: "warning", message: context.vercelLinkWarning };
  }

  // --- Install phase ---
  yield { type: "status", status: "installing" };

  const installCmd = await sandbox.runCommand({
    cmd: "sh",
    args: [
      "-lc",
      buildShellCommand(context.installCommand, context.installDir),
    ],
    env: context.runtimeEnv,
    detached: true,
  });
  const installLog = yield* streamCommandPhase(installCmd, "install");

  const installResult = await installCmd.wait();
  if (installResult.exitCode !== 0) {
    throw new SandboxBootstrapError(
      `Install failed (${context.installCommand})`,
      {
        previewUrl: context.previewUrl,
        installLog,
      }
    );
  }

  // --- Workspace deps build phase ---
  // Compile workspace:* packages (e.g. a shared TS package whose `main`
  // points at `dist/index.js`) so runtime imports resolve before dev runs.
  // Runs from repo root (null installDir) because the filter command
  // operates across the workspace, not a sub-directory. Trailing `|| true`
  // keeps us from masking downstream dev failures with a build error.
  if (context.workspaceBuildCommand) {
    const workspaceCmd = await sandbox.runCommand({
      cmd: "sh",
      args: ["-lc", `${context.workspaceBuildCommand} 2>&1 || true`],
      env: context.runtimeEnv,
      detached: true,
    });
    yield* streamCommandPhase(workspaceCmd, "workspace");
    await workspaceCmd.wait();
  }

  // --- Rebuild phase ---
  if (!opts.installCommand && context.strategy.rebuildTargets?.length) {
    const rebuildCmd = buildSelectiveRebuildCommand(
      context.packageManager,
      context.strategy.rebuildTargets
    );
    const rebuild = await sandbox.runCommand({
      cmd: "sh",
      args: ["-lc", buildShellCommand(rebuildCmd, context.installDir)],
      env: context.runtimeEnv,
      detached: true,
    });
    yield* streamCommandPhase(rebuild, "rebuild");
    await rebuild.wait();
  }

  // --- No dev script: done early ---
  if (!context.hasDevScript) {
    yield {
      type: "log",
      phase: "dev",
      data: `${NO_DEV_SCRIPT_MESSAGE}\n`,
    };
    yield { type: "preview_url", url: context.previewUrl };
    yield { type: "status", status: "running" };
    return;
  }

  // --- Dev server phase ---
  const devLaunch = await launchDetachedDevCommand(
    sandbox,
    context.normalizedRoot,
    context.devCommand,
    context.runtimeEnv
  );

  yield { type: "preview_url", url: context.previewUrl };
  yield* streamPreviewSignal(
    sandbox,
    devLaunch,
    context.previewUrl,
    context.devLogPath,
    context.readiness
  );

  yield { type: "status", status: "running" };
}

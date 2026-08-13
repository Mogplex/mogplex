import type { Sandbox } from "@vercel/sandbox";
import { buildRuntimeSandboxEnv } from "@/lib/repo-settings";
import type { SandboxBootstrapStreamEvent } from "@/lib/sandbox/events";
import type {
  ResolvedBootstrapContext,
  SandboxBootstrapLogPhase,
  PreviewReadinessOptions,
  PreviewReadyResult,
  SandboxStreamingCommand,
} from "./client-types";
import {
  SandboxBootstrapError,
  withTimeout,
  BOOTSTRAP_STEP_TIMEOUT_MS,
} from "./client-validation";
import {
  buildShellCommand,
  buildDetachedDevLaunchCommand,
  buildSelectiveRebuildCommand,
  buildEnsureBunCommand,
  buildWithBunOnPathCommand,
  SANDBOX_BUN_VERSION,
} from "./client-shell";
import {
  NO_DEV_SCRIPT_MESSAGE,
  logSignalsPreviewReady,
  extractBoundPortFromLog,
  replacePortInSandboxDomain,
  resolveRetriedPreviewHealthResult,
  resolveClosedPreviewSignal,
  resolveTimedOutPreviewSignal,
  createPreviewSignalTimeoutPromise,
  createPreviewSignalExitPromise,
  nextPreviewSignalWinner,
} from "./client-readiness";

export async function launchDetachedDevCommand(
  sandbox: Sandbox,
  normalizedRoot: string | null,
  devCommand: string,
  runtimeEnv: ReturnType<typeof buildRuntimeSandboxEnv>,
  opts: { timeoutLabel?: string; requiresBun?: boolean } = {}
) {
  const launchCommand =
    opts.requiresBun === true
      ? buildWithBunOnPathCommand(devCommand)
      : devCommand;
  const command = sandbox.runCommand({
    cmd: "sh",
    args: [
      "-lc",
      buildShellCommand(
        buildDetachedDevLaunchCommand(launchCommand),
        normalizedRoot
      ),
    ],
    env: runtimeEnv,
    detached: true,
  });

  return opts.timeoutLabel
    ? withTimeout(command, BOOTSTRAP_STEP_TIMEOUT_MS, opts.timeoutLabel)
    : command;
}

export async function runInstallPhase(
  sandbox: Sandbox,
  installCommand: string,
  installDir: string | null,
  runtimeEnv: ReturnType<typeof buildRuntimeSandboxEnv>,
  previewUrl: string
) {
  const install = await withTimeout(
    sandbox.runCommand({
      cmd: "sh",
      args: ["-lc", buildShellCommand(installCommand, installDir)],
      env: runtimeEnv,
    }),
    BOOTSTRAP_STEP_TIMEOUT_MS,
    `Install (${installCommand})`
  );
  const [installStdout, installStderr] = await Promise.all([
    install.stdout(),
    install.stderr(),
  ]);
  const installLog = [installStdout, installStderr]
    .filter(Boolean)
    .join("\n")
    .trim();
  if (install.exitCode !== 0) {
    throw new SandboxBootstrapError(`Install failed (${installCommand})`, {
      installLog,
      previewUrl,
    });
  }

  return installLog;
}

/**
 * Build workspace:* dependencies so their compiled outputs exist before
 * `pnpm dev` runs. Runs from the repo root (null installDir) because the
 * filter command operates across the entire workspace, not a sub-package.
 *
 * Swallows non-zero exit to avoid masking downstream dev failures — if a
 * workspace build truly breaks dev, the dev log will show the real cause.
 */
export async function runWorkspaceBuildPhase(
  sandbox: Sandbox,
  workspaceBuildCommand: string | null,
  runtimeEnv: ReturnType<typeof buildRuntimeSandboxEnv>
): Promise<string> {
  if (!workspaceBuildCommand) return "";
  const command = await withTimeout(
    sandbox.runCommand({
      cmd: "sh",
      args: ["-lc", `${workspaceBuildCommand} 2>&1 || true`],
      env: runtimeEnv,
    }),
    BOOTSTRAP_STEP_TIMEOUT_MS,
    `Workspace deps build (${workspaceBuildCommand})`
  );
  const [stdout, stderr] = await Promise.all([
    command.stdout(),
    command.stderr(),
  ]);
  return [stdout, stderr].filter(Boolean).join("\n").trim();
}

export async function runSelectiveRebuildPhase(
  sandbox: Sandbox,
  context: Pick<
    ResolvedBootstrapContext,
    "packageManager" | "installDir" | "runtimeEnv" | "strategy"
  >,
  hasCustomInstallCommand: boolean
) {
  if (hasCustomInstallCommand || !context.strategy.rebuildTargets?.length) {
    return;
  }

  const rebuildCmd = buildSelectiveRebuildCommand(
    context.packageManager,
    context.strategy.rebuildTargets
  );
  await withTimeout(
    sandbox.runCommand({
      cmd: "sh",
      args: ["-lc", buildShellCommand(rebuildCmd, context.installDir)],
      env: context.runtimeEnv,
    }),
    BOOTSTRAP_STEP_TIMEOUT_MS,
    "Selective rebuild"
  );
}

export async function runRuntimePrerequisitePhase(
  sandbox: Sandbox,
  requiresBun: boolean,
  runtimeEnv: ReturnType<typeof buildRuntimeSandboxEnv>,
  previewUrl: string
): Promise<string> {
  if (!requiresBun) return "";

  const command = await withTimeout(
    sandbox.runCommand({
      cmd: "sh",
      args: ["-lc", buildEnsureBunCommand()],
      env: runtimeEnv,
    }),
    BOOTSTRAP_STEP_TIMEOUT_MS,
    "Runtime prerequisite install (bun)"
  );
  const [stdout, stderr] = await Promise.all([
    command.stdout(),
    command.stderr(),
  ]);
  const installLog = [stdout, stderr].filter(Boolean).join("\n").trim();
  if (command.exitCode !== 0) {
    throw new SandboxBootstrapError("Runtime prerequisite failed (bun)", {
      installLog,
      previewUrl,
    });
  }

  return installLog;
}

export async function* streamRuntimePrerequisitePhase(
  sandbox: Sandbox,
  requiresBun: boolean,
  runtimeEnv: ReturnType<typeof buildRuntimeSandboxEnv>,
  previewUrl: string
): AsyncGenerator<SandboxBootstrapStreamEvent, string> {
  if (!requiresBun) return "";

  yield {
    type: "log",
    phase: "install",
    data: "Ensuring Bun runtime is available...\n",
  };
  const installLog = await runRuntimePrerequisitePhase(
    sandbox,
    requiresBun,
    runtimeEnv,
    previewUrl
  );
  yield {
    type: "log",
    phase: "install",
    data: `Bun ${SANDBOX_BUN_VERSION} ready.\n`,
  };
  return installLog;
}

export async function* streamCommandPhase(
  command: SandboxStreamingCommand,
  phase: SandboxBootstrapLogPhase
): AsyncGenerator<SandboxBootstrapStreamEvent, string> {
  let output = "";

  for await (const log of command.logs()) {
    output += log.data;
    yield { type: "log", phase, data: log.data };
  }

  return output.trim();
}

export async function* streamPreviewSignal(
  sandbox: Sandbox,
  command: SandboxStreamingCommand,
  previewUrl: string,
  devLogPath: string,
  readiness?: PreviewReadinessOptions
): AsyncGenerator<SandboxBootstrapStreamEvent, PreviewReadyResult> {
  const logIterator = command.logs()[Symbol.asyncIterator]();
  const timeoutPromise = createPreviewSignalTimeoutPromise();
  const exitPromise = createPreviewSignalExitPromise(command);
  let activePreviewUrl = previewUrl;

  try {
    while (true) {
      const winner = await nextPreviewSignalWinner(
        logIterator,
        exitPromise,
        timeoutPromise
      );

      if (winner.kind === "log") {
        if (winner.entry.done) {
          return resolveClosedPreviewSignal(
            sandbox,
            activePreviewUrl,
            devLogPath,
            readiness
          );
        }

        const chunk = winner.entry.value.data;
        yield { type: "log", phase: "dev", data: chunk };

        // If the dev server tells us its actual port (e.g. Next fell back
        // from 3000 to 3003), follow it. Emits a new preview_url event so
        // the UI stops probing the wrong domain.
        const boundPort = extractBoundPortFromLog(chunk);
        if (boundPort) {
          const { url: nextUrl, changed } = replacePortInSandboxDomain(
            sandbox,
            activePreviewUrl,
            boundPort
          );
          if (changed) {
            activePreviewUrl = nextUrl;
            yield { type: "preview_url", url: nextUrl };
          }
        }

        if (!logSignalsPreviewReady(chunk)) {
          continue;
        }

        const result = await resolveRetriedPreviewHealthResult(
          sandbox,
          activePreviewUrl,
          devLogPath,
          readiness
        );
        if (result) {
          return result;
        }
        continue;
      }

      if (winner.kind === "exit") {
        return resolveClosedPreviewSignal(
          sandbox,
          activePreviewUrl,
          devLogPath,
          readiness
        );
      }

      return resolveTimedOutPreviewSignal(
        sandbox,
        activePreviewUrl,
        devLogPath,
        readiness
      );
    }
  } finally {
    await logIterator.return?.();
  }
}

export function buildNoDevScriptBootstrapResult(
  context: Pick<
    ResolvedBootstrapContext,
    | "previewUrl"
    | "effectiveRuntime"
    | "packageManager"
    | "framework"
    | "installCommand"
  >,
  installLog: string
) {
  return {
    previewUrl: context.previewUrl,
    runtime: context.effectiveRuntime,
    packageManager: context.packageManager,
    framework: context.framework,
    installCommand: context.installCommand,
    devCommand: "(none)",
    installLog,
    devLog: NO_DEV_SCRIPT_MESSAGE,
    healthStatus: "running" as const,
    readiness: { ready: true as const },
  };
}

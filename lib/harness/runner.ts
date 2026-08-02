import { getHarnessConfig } from "./config";
import { installHarnessPackage, isHarnessInstalled } from "./install";
import type { HarnessId } from "./config";
import type { Sandbox, Command } from "@vercel/sandbox";
import type { HarnessExecutionMode } from "./claude-permissions";

type RunHarnessOpts = {
  continue?: boolean;
  resumeSessionId?: string | null;
  mode?: HarnessExecutionMode;
  cwd?: string;
  runtimeEnv?: Record<string, string>;
  mcpConfigPath?: string;
  shouldCancel?: () => boolean | Promise<boolean>;
};

type RunHarnessResult = {
  command: Command;
  installed: boolean;
  installLogs?: string;
};

export class HarnessCancelRequestedError extends Error {
  installed: boolean;
  installLogs?: string;

  constructor(
    message = "Harness cancellation requested",
    opts?: { installed?: boolean; installLogs?: string }
  ) {
    super(message);
    this.name = "HarnessCancelRequestedError";
    this.installed = opts?.installed ?? false;
    this.installLogs = opts?.installLogs;
  }
}

async function throwIfCancelled(
  shouldCancel: RunHarnessOpts["shouldCancel"],
  opts?: { installed?: boolean; installLogs?: string }
) {
  if (!shouldCancel) return;
  if (await shouldCancel()) {
    throw new HarnessCancelRequestedError(
      "Harness cancellation requested",
      opts
    );
  }
}

export async function runHarness(
  sandbox: Sandbox,
  harnessId: HarnessId,
  prompt: string,
  auth: string | Record<string, string>,
  opts?: RunHarnessOpts
): Promise<RunHarnessResult> {
  const config = getHarnessConfig(harnessId);

  let installed = false;
  let installLogs: string | undefined;

  await throwIfCancelled(opts?.shouldCancel);
  const alreadyInstalled = await isHarnessInstalled(sandbox, harnessId);
  await throwIfCancelled(opts?.shouldCancel);
  if (!alreadyInstalled) {
    installLogs = await installHarnessPackage(sandbox, harnessId);
    installed = true;
    await throwIfCancelled(opts?.shouldCancel, { installed, installLogs });
  }

  const { cmd, args } = config.buildCommand(prompt, {
    continue: opts?.continue,
    resumeSessionId: opts?.resumeSessionId,
    mode: opts?.mode,
    mcpConfigPath: opts?.mcpConfigPath,
  });

  const env: Record<string, string> =
    typeof auth === "string"
      ? {
          [config.envVar]: auth,
          ...opts?.runtimeEnv,
        }
      : {
          ...auth,
          ...opts?.runtimeEnv,
        };

  await throwIfCancelled(opts?.shouldCancel, { installed, installLogs });
  const command = await sandbox.runCommand({
    cmd,
    args,
    detached: true,
    cwd: opts?.cwd,
    env,
  });

  return { command, installed, installLogs };
}

import { resolveSandboxWorkingDirectory } from "@/lib/sandbox/working-directory";
import { resolveHarnessAcpAgent } from "./acp/agent";
import { buildAcpAgentEnv, buildAcpRunConfig, writeAcpRun } from "./acp/launch";
import { getHarnessConfig } from "./config";
import { codexResearchArgs } from "./research-auth";
import { codexProviderArgs, codexWorkerIsolationArgs } from "./codex-provider";
import {
  installHarnessPackage,
  isHarnessInstalled,
  resolveHarnessInstallTarget,
} from "./install";
import type { HarnessAcpAgent, HarnessId } from "./config";
import type { Sandbox, Command } from "@vercel/sandbox";
import type { HarnessExecutionMode } from "./claude-permissions";

type RunHarnessOpts = {
  continue?: boolean;
  resumeSessionId?: string | null;
  mode?: HarnessExecutionMode;
  cwd?: string;
  runtimeEnv?: Record<string, string>;
  mcpConfigPath?: string;
  researchServerName?: string;
  shouldCancel?: () => boolean | Promise<boolean>;
  /**
   * The ACP agent to launch, as the caller resolved it (see
   * `resolveHarnessAcpAgent`), so setup and launch agree; null forces the
   * CLI. Resolved from the environment when omitted.
   */
  acpAgent?: HarnessAcpAgent | null;
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
  const acpAgent =
    opts?.acpAgent === undefined
      ? resolveHarnessAcpAgent(harnessId)
      : opts.acpAgent;
  const installTarget = resolveHarnessInstallTarget(harnessId, acpAgent);

  let installed = false;
  let installLogs: string | undefined;

  await throwIfCancelled(opts?.shouldCancel);
  const alreadyInstalled = await isHarnessInstalled(
    sandbox,
    harnessId,
    installTarget
  );
  await throwIfCancelled(opts?.shouldCancel);
  if (!alreadyInstalled) {
    installLogs = await installHarnessPackage(
      sandbox,
      harnessId,
      installTarget
    );
    installed = true;
    await throwIfCancelled(opts?.shouldCancel, { installed, installLogs });
  }

  const authEnv: Record<string, string> =
    typeof auth === "string" ? { [config.envVar]: auth } : auth;
  const cwd = resolveSandboxWorkingDirectory(opts?.cwd);
  let cmd: string;
  let args: string[];
  let env: Record<string, string>;

  if (acpAgent) {
    // One ACP turn behind the in-sandbox bridge. MCP servers, including the
    // research server, come from the MCP config file for every harness.
    const baseEnv = { ...authEnv, ...opts?.runtimeEnv };
    ({ cmd, args } = await writeAcpRun(
      sandbox,
      buildAcpRunConfig({
        harnessId,
        agent: acpAgent,
        prompt,
        cwd,
        mode: opts?.mode,
        resumeSessionId: opts?.resumeSessionId,
        mcpConfigPath: opts?.mcpConfigPath,
        env: baseEnv,
      })
    ));
    env = { ...baseEnv, ...buildAcpAgentEnv(harnessId, baseEnv, opts?.mode) };
  } else {
    ({ cmd, args } = config.buildCommand(prompt, {
      continue: opts?.continue,
      resumeSessionId: opts?.resumeSessionId,
      mode: opts?.mode,
      mcpConfigPath: opts?.mcpConfigPath,
      researchServerName: opts?.researchServerName,
    }));
    env = { ...authEnv, ...opts?.runtimeEnv };
    if (harnessId === "codex") {
      args = [
        ...codexProviderArgs(env),
        ...codexResearchArgs(env),
        ...codexWorkerIsolationArgs(),
        ...args,
      ];
    }
  }

  await throwIfCancelled(opts?.shouldCancel, { installed, installLogs });
  // Persistent Linux sandboxes can give their non-root user ambient
  // capabilities. Codex's bubblewrap rejects those privileges. Drop them
  // before exec, without changing the selected Codex sandbox/approval policy.
  // setpriv (util-linux) is required; never fall back to an unisolated launch.
  // The ACP bridge inherits the same restriction for the Codex it starts.
  const command = await sandbox.runCommand({
    cmd: harnessId === "codex" ? "setpriv" : cmd,
    args:
      harnessId === "codex"
        ? [
            "--no-new-privs",
            "--inh-caps=-all",
            "--ambient-caps=-all",
            "--",
            cmd,
            ...args,
          ]
        : args,
    detached: true,
    // The provider resolves a relative cwd against `/`; anchor it under the
    // checkout so a monorepo root directory such as `apps/web` works.
    cwd,
    env,
  });

  return { command, installed, installLogs };
}

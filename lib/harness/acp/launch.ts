import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Sandbox } from "@vercel/sandbox";
import type { HarnessExecutionMode } from "@/lib/harness/claude-permissions";
import type { HarnessAcpAgent, HarnessId } from "@/lib/harness/config";
import { SANDBOX_WORKSPACE_ROOT } from "@/lib/sandbox/working-directory";
import {
  acpPermissionPolicy,
  codexAcpAuth,
  codexAcpEnv,
  codexAcpModeId,
  type AcpGatewayAuth,
} from "./agent";
import { ACP_BRIDGE_SCRIPT } from "./bridge-script";

// Under the workspace's `.mogplex/`, which git sync ignores and delivery
// refuses to commit, beside the terminal bridge.
const ACP_RUNTIME_DIR = path.posix.join(SANDBOX_WORKSPACE_ROOT, ".mogplex");
export const ACP_BRIDGE_PATH = path.posix.join(
  ACP_RUNTIME_DIR,
  "acp-bridge.mjs"
);

/** What `ACP_BRIDGE_SCRIPT` reads: one prompt turn against one agent. */
export type AcpRunConfig = {
  agent: { command: string; args: string[] };
  cwd: string;
  prompt: string;
  modeId: string | null;
  resumeSessionId: string | null;
  mcpConfigPath: string | null;
  permissions: ReturnType<typeof acpPermissionPolicy>;
  auth: AcpGatewayAuth | null;
};

export function buildAcpRunConfig(input: {
  harnessId: HarnessId;
  agent: HarnessAcpAgent;
  prompt: string;
  cwd: string;
  mode?: HarnessExecutionMode;
  resumeSessionId?: string | null;
  mcpConfigPath?: string;
  /** The run's environment, for the model endpoint the agent signs in to. */
  env: Record<string, string>;
}): AcpRunConfig {
  return {
    agent: { command: input.agent.binary, args: [] },
    cwd: input.cwd,
    prompt: input.prompt,
    modeId: input.harnessId === "codex" ? codexAcpModeId(input.mode) : null,
    resumeSessionId: input.resumeSessionId?.trim() || null,
    // The MCP config is written relative to the run's checkout.
    mcpConfigPath: input.mcpConfigPath
      ? path.posix.resolve(input.cwd, input.mcpConfigPath)
      : null,
    permissions: acpPermissionPolicy(input.mode),
    auth: input.harnessId === "codex" ? codexAcpAuth(input.env) : null,
  };
}

/** Variables the agent's ACP server reads at startup. */
export function buildAcpAgentEnv(
  harnessId: HarnessId,
  env: Record<string, string>,
  mode?: HarnessExecutionMode
): Record<string, string> {
  return harnessId === "codex" ? codexAcpEnv(env, mode) : {};
}

/**
 * Writes the bridge and this run's config into the sandbox and returns the
 * command that runs the turn. Each run gets its own config file (the bridge
 * deletes it once read) so concurrent workers in one sandbox never share a
 * prompt.
 */
export async function writeAcpRun(
  sandbox: Pick<Sandbox, "writeFiles">,
  config: AcpRunConfig
): Promise<{ cmd: string; args: string[] }> {
  const runPath = path.posix.join(
    ACP_RUNTIME_DIR,
    `acp-run-${randomUUID()}.json`
  );
  await sandbox.writeFiles([
    { path: ACP_BRIDGE_PATH, content: Buffer.from(ACP_BRIDGE_SCRIPT) },
    { path: runPath, content: Buffer.from(JSON.stringify(config)) },
  ]);
  return { cmd: "node", args: [ACP_BRIDGE_PATH, runPath] };
}

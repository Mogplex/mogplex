import type { Sandbox } from "@vercel/sandbox";
import type { SandboxGitAuthor } from "@/lib/sandbox/git-author";
import {
  ensureDevTools,
  syncTerminalRuntimeAuth,
} from "@/lib/sandbox/dev-tools";
import { buildAgentWorkspaceCleanupScript } from "@/lib/sandbox/agent-git-sync";

/** Prepare the native task's checkout before exposing it to the agent. */
export async function prepareTaskWorkspace(
  sandbox: Sandbox,
  input: { cwd?: string; githubToken: string; author: SandboxGitAuthor }
) {
  const tools = await ensureDevTools(sandbox, {
    agentName: input.author.name,
    agentEmail: input.author.email,
  });
  if (!tools.ok) throw new Error("Task workspace tools could not be prepared");
  const auth = await syncTerminalRuntimeAuth(sandbox, {
    githubToken: input.githubToken,
  });
  if (!auth.ok) throw new Error("Task workspace GitHub access is unavailable");
  const result = await sandbox.runCommand({
    cmd: "sh",
    args: [
      "-lc",
      `export PATH="$HOME/.local/bin:$PATH"\ngh --version >/dev/null || exit 1\n${buildAgentWorkspaceCleanupScript()}`,
    ],
    cwd: input.cwd,
  });
  if (result.exitCode !== 0) {
    throw new Error("Task workspace could not be prepared");
  }
}

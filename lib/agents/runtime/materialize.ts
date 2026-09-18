/**
 * Writes agent runtime files into a sandbox checkout under `.mogplex/agent/`.
 * The directory is self-ignored by git, so skill files never reach a commit.
 */
import type { Sandbox } from "@vercel/sandbox";
import { ensureMogplexGitignore } from "@/lib/harness/mcp-config";
import { resolveSandboxPath } from "@/lib/repo-settings";
import type { AgentRuntimeFile } from "./instructions";

export type AgentRuntimeWritableSandbox = Pick<
  Sandbox,
  "writeFiles" | "readFile"
>;

export async function materializeAgentRuntimeFiles(input: {
  sandbox: AgentRuntimeWritableSandbox;
  rootDirectory: string | null | undefined;
  files: AgentRuntimeFile[];
}): Promise<string[]> {
  if (input.files.length === 0) return [];
  await ensureMogplexGitignore(input.sandbox, input.rootDirectory);
  const written = input.files.map((file) => ({
    path: resolveSandboxPath(input.rootDirectory, file.path),
    content: Buffer.from(file.content),
  }));
  await input.sandbox.writeFiles(written);
  return written.map((file) => file.path);
}

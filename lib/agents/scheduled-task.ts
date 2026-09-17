import { tool } from "ai";
import { z } from "zod";
import { readCommandOutput, type SandboxFileAccess } from "./pr-fixer-utils";

export function buildScheduledTaskTools(config: {
  githubToken: string;
  loadSandbox: () => Promise<{ sandbox: SandboxFileAccess; cwd?: string }>;
}) {
  return {
    runCommand: tool({
      description:
        "Run a shell command in the task checkout. Use git and gh to inspect open PRs, run checks, and open a PR on the prepared branch. Never merge, print credentials, or push to the default branch.",
      inputSchema: z.object({ command: z.string().min(1) }),
      execute: async ({ command }) => {
        const { sandbox, cwd } = await config.loadSandbox();
        const result = await sandbox.runCommand({
          cmd: "sh",
          args: ["-lc", command],
          cwd,
          env: {
            GH_TOKEN: config.githubToken,
            GITHUB_TOKEN: config.githubToken,
          },
        });
        const [stdout, stderr] = await Promise.all([
          readCommandOutput(result, "stdout"),
          readCommandOutput(result, "stderr"),
        ]);
        return { exitCode: result.exitCode, stdout, stderr };
      },
    }),
  };
}

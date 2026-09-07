/**
 * Control file tools that follow the request-local sandbox binding.
 *
 * The coordinator may start a sandbox mid-turn, so the read tools decide per
 * call: a bound sandbox serves the live checkout (uncommitted edits included);
 * otherwise the GitHub API serves the committed tree.
 */
import { tool as defineTool, type Tool } from "ai";
import { z } from "zod";
import {
  createReadFile as createGithubReadFile,
  createListFiles as createGithubListFiles,
} from "@/lib/agents/tools/github-files";
import {
  createSandboxListFiles,
  createSandboxReadFile,
} from "@/lib/agents/tools/sandbox-files";
import type { OrchestratorToolContext, RepoToolDefaults } from "../types";

type Executable = {
  execute?: (input: never, options: never) => unknown;
};

const readFileParams = z.object({
  path: z.string().describe("File path relative to the repository root"),
  offset: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("First line to return (1-based). Sandbox reads only."),
  limit: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Maximum lines to return. Sandbox reads only."),
});

const listFilesParams = z.object({
  path: z
    .string()
    .default("")
    .describe("Directory path relative to the repository root"),
});

function hasBoundSandbox(ctx: OrchestratorToolContext): boolean {
  return Boolean(ctx.sandboxBinding?.sandboxId);
}

async function run(
  candidate: Tool,
  input: Record<string, unknown>,
  options: unknown
): Promise<unknown> {
  const execute = (candidate as Executable).execute;
  if (!execute) return { error: "tool_unavailable" };
  return execute(input as never, options as never);
}

/**
 * read_file that reads the live sandbox checkout when one is bound and falls
 * back to the committed GitHub tree otherwise.
 */
export function createControlReadFile(
  ctx: OrchestratorToolContext,
  repoDefaults: RepoToolDefaults
): Tool {
  const sandboxTool = createSandboxReadFile(ctx.userId, ctx.sandboxBinding);
  const githubTool = createGithubReadFile(ctx.githubToken, repoDefaults);
  return defineTool({
    description:
      "Read a file. With a running sandbox this reads the live checkout, including uncommitted edits, as line-numbered text (number, tab, text) that you can page with offset and limit. Without a sandbox it reads the committed tree from GitHub.",
    inputSchema: readFileParams,
    execute: async (input: z.infer<typeof readFileParams>, options) => {
      if (hasBoundSandbox(ctx)) return run(sandboxTool, input, options);
      return run(githubTool, { path: input.path }, options);
    },
  });
}

/**
 * list_files that lists the live sandbox checkout when one is bound and the
 * committed GitHub tree otherwise.
 */
export function createControlListFiles(
  ctx: OrchestratorToolContext,
  repoDefaults: RepoToolDefaults
): Tool {
  const sandboxTool = createSandboxListFiles(ctx.userId, ctx.sandboxBinding);
  const githubTool = createGithubListFiles(ctx.githubToken, repoDefaults);
  return defineTool({
    description:
      "List a directory. With a running sandbox this lists the live checkout; without one it lists the committed tree from GitHub. Prefer run_command with rg or find for recursive searches.",
    inputSchema: listFilesParams,
    execute: async (input: z.infer<typeof listFilesParams>, options) => {
      if (hasBoundSandbox(ctx)) return run(sandboxTool, input, options);
      return run(githubTool, { path: input.path }, options);
    },
  });
}

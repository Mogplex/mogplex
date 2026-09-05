import type { Tool } from "ai";

// These tools share the selected sandbox's existing one-command lease. Queue
// simultaneous calls from one model step instead of making them race for it.
const SANDBOX_COMMAND_TOOLS = new Set([
  "run_command",
  "diff_worktree",
  "rebase_worktree",
  "spawn_worktree",
  "prune_worktree",
]);

export function serializeSandboxCommandTools(
  tools: Record<string, Tool>
): Record<string, Tool> {
  let previous: Promise<unknown> = Promise.resolve();
  return Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => {
      const execute = tool.execute;
      if (!execute || !SANDBOX_COMMAND_TOOLS.has(name)) return [name, tool];
      return [
        name,
        {
          ...tool,
          execute: (...args: Parameters<typeof execute>) => {
            const result = previous.then(() => {
              args[1]?.abortSignal?.throwIfAborted();
              return execute(...args);
            });
            previous = result.catch(() => undefined);
            return result;
          },
        },
      ];
    })
  );
}

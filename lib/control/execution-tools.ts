import type { ToolSet } from "ai";
import { serializeSandboxCommandTools } from "@/lib/agents/orchestrator/serialized-commands";
import { journalControlTools } from "./tool-journal";

export function durableControlTools(
  tools: ToolSet | undefined,
  context: { userId: string; aiCallId: string },
  checkpoint: (name: string) => Promise<void>
) {
  if (!tools) return tools;
  const journaled = journalControlTools(tools, context);
  const captured = Object.fromEntries(
    Object.entries(journaled).map(([name, tool]) => {
      const execute = tool.execute;
      if (!execute) return [name, tool];
      return [
        name,
        {
          ...tool,
          async execute(input: never, options: Parameters<typeof execute>[1]) {
            if (name === "sandbox_stop") await checkpoint(name);
            try {
              return await execute(input, options);
            } finally {
              if (name !== "sandbox_stop") await checkpoint(name);
            }
          },
        },
      ];
    })
  ) as ToolSet;
  // Hold the local sequence through the Git checkpoint too, so the following
  // mutation cannot race the snapshot of the command that just finished.
  return serializeSandboxCommandTools(captured);
}

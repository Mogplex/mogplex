import { z } from "zod";
import { virtualExec } from "@/lib/virtual-shell";
import { defineTool } from "./shared";

const virtualExecParams = z.object({
  command: z.string().describe("Bash command to run in the virtual shell"),
});

export const virtualExecTool = defineTool({
  description:
    "Run a command in an instant, in-memory virtual bash shell (~10ms). Supports ~100 Unix commands: grep, sed, awk, jq, sort, uniq, wc, head, tail, cut, tr, find, cat, echo, printf, date, base64, and more. The filesystem starts empty and has no network access. Use this for text processing and data analysis — pipe output from read_file through grep/sed/awk/jq. Use bash instead when you need real project files, git, package managers, or network access.",
  inputSchema: virtualExecParams,
  execute: async ({ command }: z.infer<typeof virtualExecParams>) => {
    try {
      return await virtualExec(command);
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : "virtual_exec failed",
        command,
      };
    }
  },
});

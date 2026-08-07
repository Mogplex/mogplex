import { PRECONFIGURED_AGENTS } from "@/lib/agents/templates";
import {
  buildHarnessSlashCommands,
  getHarnessIdFromModelId,
} from "@/lib/harness/slash-commands";
import type { CommandResult, SlashCommand } from "@/lib/slash-command-types";

export type { CommandResult, SlashCommand } from "@/lib/slash-command-types";

export const MODES = ["AUTO", "YOLO", "SAFE"] as const;

function buildModeCommand(): SlashCommand {
  return {
    name: "mode",
    description: "Set permission mode (AUTO/YOLO/SAFE)",
    args: "<mode>",
    execute: (args) => {
      const m = args.trim().toUpperCase();
      if (MODES.includes(m as (typeof MODES)[number])) {
        return { output: `Mode set to ${m}`, action: "set_mode", payload: m };
      }
      return { output: `Available modes: ${MODES.join(", ")}` };
    },
  };
}

function buildChatBuiltinCommands(models: string[]): SlashCommand[] {
  return [
    {
      name: "model",
      description: "Switch AI model",
      args: "<model-name>",
      execute: (args) => {
        const model = args.trim();
        if (!model) {
          return { output: `Available: ${models.join(", ")}` };
        }
        const match = models.find((m) => m.includes(model));
        if (match) {
          return {
            output: `Model set to ${match}`,
            action: "set_model",
            payload: match,
          };
        }
        return { output: `Unknown model: ${model}` };
      },
    },
    buildModeCommand(),
    {
      name: "clear",
      description: "Clear terminal output",
      execute: () => ({ output: "", action: "clear" }),
    },
    {
      name: "help",
      description: "Show available commands",
      execute: () => ({ output: "", action: "help" }),
    },
    {
      name: "tools",
      description: "List available agent tools",
      execute: () => ({
        output: [
          "Available tools:",
          "  web_search — Search the web via DuckDuckGo",
          "  web_fetch — Fetch a public URL for source-backed context",
          "  browse_skills — Search skills.sh registry",
          "  browse_vercel_docs — Search Vercel documentation",
          "  bash — Run shell commands in sandbox",
          "  read_file — Read a file from the repository",
          "  list_files — List files in a directory",
          "  write_file — Write a file in the sandbox",
        ].join("\n"),
        action: "help" as const,
      }),
    },
    {
      name: "agent",
      description: "Browse agent templates",
      args: "[template-name]",
      execute: (args) => {
        if (!args.trim()) {
          const list = PRECONFIGURED_AGENTS.map(
            (t) => `  ${t.name} — ${t.description}`
          ).join("\n");
          return {
            output: `Agent templates:\n${list}`,
            action: "help" as const,
          };
        }
        const q = args.trim().toLowerCase();
        const match = PRECONFIGURED_AGENTS.find((t) =>
          t.name.toLowerCase().includes(q)
        );
        if (match) {
          return {
            output: `${match.name}\n  ${match.description}\n  Category: ${match.category}\n  Model: ${match.model}`,
            action: "help" as const,
          };
        }
        return { output: `No template matching "${args.trim()}"` };
      },
    },
  ];
}

export function buildBuiltinCommands(input: {
  models: string[];
  selectedModel?: string | null;
}): SlashCommand[] {
  const harnessId = getHarnessIdFromModelId(input.selectedModel);
  if (!harnessId) {
    return buildChatBuiltinCommands(input.models);
  }

  return [buildModeCommand(), ...buildHarnessSlashCommands(harnessId)];
}

export function parseSlashCommand(
  input: string,
  builtins: SlashCommand[],
  custom: SlashCommand[] = [],
  options?: { allowUnknown?: boolean }
): CommandResult | null {
  if (!input.startsWith("/")) return null;
  const [cmd, ...rest] = input.slice(1).split(" ");
  const args = rest.join(" ");
  const all = [...builtins, ...custom];
  const found = all.find((c) => c.name === cmd);
  if (!found) {
    return options?.allowUnknown
      ? null
      : { output: `Unknown command: /${cmd}` };
  }
  return found.execute(args);
}

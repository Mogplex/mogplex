// Leaf module: imported by both lib/slash-commands.ts and
// lib/harness/slash-commands.ts, so it must not import from either.
export type SlashCommand = {
  name: string;
  description: string;
  args?: string;
  execute: (args: string) => CommandResult;
};

export type CommandResult = {
  output: string;
  action?:
    | "set_model"
    | "set_mode"
    | "clear"
    | "help"
    | "custom"
    | "passthrough";
  payload?: unknown;
};

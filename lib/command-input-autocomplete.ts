import type { SlashCommand } from "@/lib/slash-commands";

export type CommandInputSuggestion =
  | SlashCommand
  | {
      name: string;
      description: string;
      isModel: true;
    };

type GetCommandInputSuggestionsParams = {
  value: string;
  commands: SlashCommand[];
  models: string[];
  selectedModel?: string | null;
};

export function getCommandInputSuggestions({
  value,
  commands,
  models,
  selectedModel,
}: GetCommandInputSuggestionsParams): CommandInputSuggestion[] {
  if (!value.startsWith("/")) return [];

  // Keep the existing local model picker behavior for non-harness chat mode.
  if (value === "/model " && !selectedModel?.startsWith("harness:")) {
    return models.map((name) => ({
      name,
      description: "Model",
      isModel: true,
    }));
  }

  const rawQuery = value.slice(1).toLowerCase();

  // Once the user has moved into command arguments, Enter should submit the
  // command rather than re-selecting the slash suggestion.
  if (rawQuery.includes(" ")) {
    return [];
  }

  return commands.filter((command) => command.name.startsWith(rawQuery));
}

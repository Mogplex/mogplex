import assert from "node:assert/strict";
import test from "node:test";
import { getCommandInputSuggestions } from "../../lib/command-input-autocomplete";
import type { SlashCommand } from "../../lib/slash-commands";

const COMMANDS: SlashCommand[] = [
  {
    name: "plan",
    description: "Switch to plan mode",
    execute: () => ({ output: "" }),
  },
  {
    name: "model",
    description: "Switch AI model",
    execute: () => ({ output: "" }),
  },
];

test("keeps slash command suggestions open while typing the command token", () => {
  const suggestions = getCommandInputSuggestions({
    value: "/pla",
    commands: COMMANDS,
    models: ["openai/gpt-5-mini"],
    selectedModel: "openai/gpt-5-mini",
  });

  assert.deepEqual(
    suggestions.map((suggestion) => suggestion.name),
    ["plan"]
  );
});

test("closes slash command suggestions after the user moves into arguments", () => {
  const suggestions = getCommandInputSuggestions({
    value: "/plan ship it",
    commands: COMMANDS,
    models: ["openai/gpt-5-mini"],
    selectedModel: "openai/gpt-5-mini",
  });

  assert.deepEqual(suggestions, []);
});

test("keeps the local /model picker for non-harness chat mode", () => {
  const suggestions = getCommandInputSuggestions({
    value: "/model ",
    commands: COMMANDS,
    models: ["openai/gpt-5-mini", "anthropic/claude-sonnet-4.6"],
    selectedModel: "openai/gpt-5-mini",
  });

  assert.deepEqual(suggestions, [
    {
      name: "openai/gpt-5-mini",
      description: "Model",
      isModel: true,
    },
    {
      name: "anthropic/claude-sonnet-4.6",
      description: "Model",
      isModel: true,
    },
  ]);
});

test("does not keep /model suggestions open in harness mode", () => {
  const suggestions = getCommandInputSuggestions({
    value: "/model opus",
    commands: COMMANDS,
    models: ["openai/gpt-5-mini"],
    selectedModel: "harness:claude-code",
  });

  assert.deepEqual(suggestions, []);
});

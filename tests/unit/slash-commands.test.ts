import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBuiltinCommands,
  parseSlashCommand,
} from "../../lib/slash-commands";

test("Claude harness builtins expose the current documented command surface", () => {
  const commands = buildBuiltinCommands({
    models: ["openai/gpt-5-mini"],
    selectedModel: "harness:claude-code",
  });

  const names = new Set(commands.map((command) => command.name));

  assert.equal(names.has("autofix-pr"), true);
  assert.equal(names.has("effort"), true);
  assert.equal(names.has("remote-control"), true);
  assert.equal(names.has("web-setup"), true);
  assert.equal(names.has("mode"), true);
});

test("Codex harness builtins include documented args for interactive commands", () => {
  const commands = buildBuiltinCommands({
    models: ["openai/gpt-5-mini"],
    selectedModel: "harness:codex",
  });

  const byName = new Map(commands.map((command) => [command.name, command]));

  assert.equal(byName.get("fast")?.args, "[on|off|status]");
  assert.equal(
    byName.get("sandbox-add-read-dir")?.args,
    "<absolute-directory-path>"
  );
});

test("chat builtin /model still resolves to a local model switch", () => {
  const commands = buildBuiltinCommands({
    models: ["openai/gpt-5-mini", "anthropic/claude-sonnet-4.6"],
    selectedModel: "openai/gpt-5-mini",
  });

  const result = parseSlashCommand("/model sonnet", commands);

  assert.deepEqual(result, {
    output: "Model set to anthropic/claude-sonnet-4.6",
    action: "set_model",
    payload: "anthropic/claude-sonnet-4.6",
  });
});

test("harness builtin /model passes through to Claude Code instead of changing Mogplex model", () => {
  const commands = buildBuiltinCommands({
    models: ["openai/gpt-5-mini"],
    selectedModel: "harness:claude-code",
  });

  const result = parseSlashCommand("/model opus", commands);

  assert.deepEqual(result, {
    output: "",
    action: "passthrough",
  });
});

test("harness mode allows unknown slash commands to fall through to the harness", () => {
  const commands = buildBuiltinCommands({
    models: ["openai/gpt-5-mini"],
    selectedModel: "harness:claude-code",
  });

  const result = parseSlashCommand("/deploy", commands, [], {
    allowUnknown: true,
  });

  assert.equal(result, null);
});

test("non-harness mode still rejects unknown slash commands locally", () => {
  const commands = buildBuiltinCommands({
    models: ["openai/gpt-5-mini"],
    selectedModel: "openai/gpt-5-mini",
  });

  const result = parseSlashCommand("/deploy", commands);

  assert.deepEqual(result, {
    output: "Unknown command: /deploy",
  });
});

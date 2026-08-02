import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_AGENT_DESCRIPTION_LENGTH,
  MAX_AGENT_NAME_LENGTH,
  MAX_AGENT_SYSTEM_PROMPT_LENGTH,
  validateAgentInput,
} from "../../lib/agents/validation";

test("validateAgentInput accepts a valid PR review agent payload", () => {
  const result = validateAgentInput({
    name: "PR-REVIEWER",
    description: "Reviews pull requests for code quality issues",
    category: "code-review",
    systemPrompt: "You are a pull request reviewer.",
    model: "minimax/minimax-m2.7",
    requireName: true,
    requireModel: true,
  });

  assert.equal(result, null);
});

test("validateAgentInput rejects names longer than the allowed limit", () => {
  const result = validateAgentInput({
    name: "A".repeat(MAX_AGENT_NAME_LENGTH + 1),
    requireName: true,
  });

  assert.equal(
    result,
    `Name must be ${MAX_AGENT_NAME_LENGTH} characters or less`
  );
});

test("validateAgentInput rejects descriptions longer than the allowed limit", () => {
  const result = validateAgentInput({
    description: "A".repeat(MAX_AGENT_DESCRIPTION_LENGTH + 1),
  });

  assert.equal(
    result,
    `Description must be ${MAX_AGENT_DESCRIPTION_LENGTH} characters or less`
  );
});

test("validateAgentInput rejects category slugs that don't match the shape", () => {
  const result = validateAgentInput({
    category: "Has Spaces",
  });

  assert.equal(result, "Invalid category");
});

test("validateAgentInput accepts any slug-shaped category value", () => {
  const result = validateAgentInput({
    category: "my-custom-category",
  });

  assert.equal(result, null);
});

test("validateAgentInput requires a category when requested", () => {
  const result = validateAgentInput({
    name: "PR-REVIEWER",
    model: "minimax/minimax-m2.7",
    category: "",
    requireName: true,
    requireModel: true,
    requireCategory: true,
  });

  assert.equal(result, "Category is required");
});

test("validateAgentInput rejects shape-invalid categories when required", () => {
  const result = validateAgentInput({
    name: "PR-REVIEWER",
    model: "minimax/minimax-m2.7",
    category: "Bogus Value!",
    requireName: true,
    requireModel: true,
    requireCategory: true,
  });

  assert.equal(result, "Invalid category");
});

test("validateAgentInput rejects system prompts longer than the allowed limit", () => {
  const result = validateAgentInput({
    systemPrompt: "A".repeat(MAX_AGENT_SYSTEM_PROMPT_LENGTH + 1),
  });

  assert.equal(result, "System prompt is too long");
});

test("validateAgentInput requires a model when requested", () => {
  const result = validateAgentInput({
    name: "PR-REVIEWER",
    model: "",
    requireName: true,
    requireModel: true,
  });

  assert.equal(result, "Model is required");
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  findPinnedHarnessVersion,
  replacePinnedHarnessVersion,
} from "../../scripts/sync-harness-configs.mjs";

const SAMPLE_SOURCE = `export const HARNESSES = {
  "claude-code": {
    package: "@anthropic-ai/claude-code",
    version: "2.1.90",
  },
  codex: {
    package: "@openai/codex",
    version: "0.118.0",
  },
};
`;

test("findPinnedHarnessVersion reads the version that follows a package entry", () => {
  assert.equal(
    findPinnedHarnessVersion(SAMPLE_SOURCE, "@anthropic-ai/claude-code"),
    "2.1.90"
  );
  assert.equal(
    findPinnedHarnessVersion(SAMPLE_SOURCE, "@openai/codex"),
    "0.118.0"
  );
});

test("replacePinnedHarnessVersion updates only the targeted harness package", () => {
  const updated = replacePinnedHarnessVersion(
    SAMPLE_SOURCE,
    "@openai/codex",
    "0.119.0"
  );

  assert.match(updated, /package: "@openai\/codex",\s+version: "0.119.0"/);
  assert.match(
    updated,
    /package: "@anthropic-ai\/claude-code",\s+version: "2.1.90"/
  );
});

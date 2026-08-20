import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  loadSlackEventTask,
  restoreFetch,
} from "./helpers/slack-event-task-fixtures";

after(() => {
  restoreFetch();
});

test("formats safe Slack milestones for known tools", async () => {
  const { formatSlackAgentProgress } = await loadSlackEventTask();

  assert.equal(
    formatSlackAgentProgress({ type: "model_working" }),
    "_Working through the details..._"
  );

  assert.equal(
    formatSlackAgentProgress({
      type: "tool_started",
      toolCallId: "sandbox-1",
      toolName: "start_sandbox",
    }),
    "_Starting the sandbox..._"
  );
  assert.equal(
    formatSlackAgentProgress({
      type: "tool_started",
      toolCallId: "pr-1",
      toolName: "github_create_pull_request",
    }),
    "_Opening the pull request..._"
  );
  assert.equal(
    formatSlackAgentProgress({
      type: "tool_started",
      toolCallId: "pr-2",
      toolName: "github_update_pull_request",
    }),
    "_Updating the pull request..._"
  );
  assert.equal(
    formatSlackAgentProgress({
      type: "tool_finished",
      toolCallId: "pr-1",
      toolName: "github_create_pull_request",
      success: true,
    }),
    "_Step complete. Checking the result..._"
  );
  assert.equal(
    formatSlackAgentProgress({
      type: "tool_finished",
      toolCallId: "pr-1",
      toolName: "github_create_pull_request",
      success: false,
    }),
    "_That step failed. Trying another path..._"
  );
});

test("does not expose unknown tool names or private payloads", async () => {
  const { formatSlackAgentProgress } = await loadSlackEventTask();
  const internalToolName = "private_customer_export_v2";

  const text = formatSlackAgentProgress({
    type: "tool_started",
    toolCallId: "private-1",
    toolName: internalToolName,
  });

  assert.equal(text, "_Using a connected tool..._");
  assert.doesNotMatch(text ?? "", new RegExp(internalToolName));
});

test("formats partial model text without exposing reasoning events", async () => {
  const { formatSlackAgentProgress } = await loadSlackEventTask();

  assert.equal(
    formatSlackAgentProgress({
      type: "text_delta",
      textDelta: "[PR](https://example.test/pr)",
      accumulatedText: "Opened **the change**: [PR](https://example.test/pr)",
    }),
    "Opened *the change*: <https://example.test/pr|PR>"
  );
});

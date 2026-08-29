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
      textDelta: "[PR](https://github.com/acme/widgets/pull/84)",
      accumulatedText:
        "Opened **the change**: [PR](https://github.com/acme/widgets/pull/84)",
    }),
    "Opened *the change*: <https://github.com/acme/widgets/pull/84|PR>"
  );
});

test("sanitizes internal capability details while model text is streaming", async () => {
  const { formatSlackAgentProgress } = await loadSlackEventTask();

  const text = formatSlackAgentProgress(
    {
      type: "text_delta",
      textDelta: "blocked",
      accumulatedText:
        "github_api only supports GET/HEAD; cross-repository paths are rejected.",
    },
    { userText: "Verify the failed request." }
  );

  assert.doesNotMatch(
    text ?? "",
    /github_api|GET\/HEAD|cross-repository paths/i
  );
  assert.match(text ?? "", /GitHub connection/i);
});

test("defers partial-text formatting until the updater accepts it", async () => {
  const { createSlackAgentProgressHandler } =
    await import("../../trigger/slack-event-lib/progress");
  let pendingText: unknown;
  const handleProgress = createSlackAgentProgressHandler((text) => {
    pendingText = text;
  });

  await handleProgress({
    type: "text_delta",
    textDelta: "done",
    accumulatedText: "**done**",
  });

  assert.equal(typeof pendingText, "function");
  assert.equal((pendingText as () => string | null)(), "*done*");

  await handleProgress({
    type: "text_delta",
    textDelta: " ",
    accumulatedText: " ",
  });
  assert.equal((pendingText as () => string | null)(), null);
});

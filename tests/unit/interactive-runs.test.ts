import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTIVE_CHAT_STALE_THRESHOLD_MS,
  ACTIVE_INTERACTIVE_STALE_THRESHOLD_MS,
  PREPARED_HARNESS_STALE_THRESHOLD_MS,
  buildAiCallCompletionUpdate,
  isStaleLiveInteractiveCall,
} from "../../lib/interactive-runs";

test("buildAiCallCompletionUpdate finalizes summary status and tool call rollups", () => {
  const startedAt = new Date(Date.now() - 5_000).toISOString();
  const toolCalls = [
    {
      name: "list_files",
      input_preview: '{"path":"src"}',
      output_preview: '["index.ts"]',
    },
  ];

  const update = buildAiCallCompletionUpdate({
    startedAt,
    status: "success",
    inputTokens: 120,
    outputTokens: 45,
    toolCalls,
    metadata: { sandbox_id: "sandbox-1" },
  });

  assert.equal(update.status, "success");
  assert.equal(update.input_tokens, 120);
  assert.equal(update.output_tokens, 45);
  assert.equal(update.tool_calls_count, 1);
  assert.deepEqual(update.tool_calls, toolCalls);
  assert.equal(update.error, null);
  assert.equal(update.metadata?.sandbox_id, "sandbox-1");
  assert.equal(typeof update.completed_at, "string");
  assert.equal(typeof update.duration_ms, "number");
  assert.ok((update.duration_ms ?? 0) >= 4_000);
});

test("isStaleLiveInteractiveCall promptly reaps orphaned prepared harness calls", () => {
  const now = Date.parse("2026-03-30T12:00:00.000Z");
  const prepared = {
    type: "agent" as const,
    status: "pending" as const,
    metadata: { prepared: true },
  };

  assert.equal(
    isStaleLiveInteractiveCall(
      {
        ...prepared,
        started_at: new Date(
          now - PREPARED_HARNESS_STALE_THRESHOLD_MS - 1
        ).toISOString(),
      },
      now
    ),
    true
  );
  assert.equal(
    isStaleLiveInteractiveCall(
      {
        ...prepared,
        started_at: new Date(
          now - PREPARED_HARNESS_STALE_THRESHOLD_MS + 1
        ).toISOString(),
      },
      now
    ),
    false
  );
});

test("buildAiCallCompletionUpdate supports cancelled interactive runs", () => {
  const update = buildAiCallCompletionUpdate({
    startedAt: new Date(Date.now() - 1_000).toISOString(),
    status: "cancelled",
    cancelRequestedAt: "2026-03-22T14:45:00.000Z",
    controlState: "cancelled",
    runtimeCommandId: "cmd_123",
  });

  assert.equal(update.status, "cancelled");
  assert.equal(update.cancel_requested_at, "2026-03-22T14:45:00.000Z");
  assert.equal(update.control_state, "cancelled");
  assert.equal(update.runtime_command_id, "cmd_123");
  assert.equal(update.tool_calls_count, 0);
});

test("isStaleLiveInteractiveCall hides orphaned streaming chats after the stale threshold", () => {
  const now = Date.parse("2026-03-30T12:00:00.000Z");

  assert.equal(
    isStaleLiveInteractiveCall(
      {
        type: "chat",
        status: "streaming",
        started_at: new Date(
          now - ACTIVE_CHAT_STALE_THRESHOLD_MS - 1_000
        ).toISOString(),
      },
      now
    ),
    true
  );

  assert.equal(
    isStaleLiveInteractiveCall(
      {
        type: "chat",
        status: "streaming",
        started_at: new Date(
          now - ACTIVE_CHAT_STALE_THRESHOLD_MS + 1_000
        ).toISOString(),
      },
      now
    ),
    false
  );

  // Agent runs (Trigger.dev jobs) get the longer interactive threshold.
  // The test deliberately uses ACTIVE_INTERACTIVE_STALE_THRESHOLD_MS rather
  // than the chat threshold + arbitrary slack so the test would fail for
  // the right reason if either constant changes.
  assert.equal(
    isStaleLiveInteractiveCall(
      {
        type: "agent",
        status: "streaming",
        started_at: new Date(
          now - ACTIVE_INTERACTIVE_STALE_THRESHOLD_MS + 1_000
        ).toISOString(),
      },
      now
    ),
    false
  );

  assert.equal(
    isStaleLiveInteractiveCall(
      {
        type: "agent",
        status: "streaming",
        started_at: new Date(
          now - ACTIVE_INTERACTIVE_STALE_THRESHOLD_MS - 1_000
        ).toISOString(),
      },
      now
    ),
    true
  );

  // Chat runs are bounded by the serverless streaming timeout, so a chat
  // past the chat stale threshold must be reported as stale regardless of
  // any anchor fields the row may carry — keeps parity with
  // claim_chat_limit_admission.
  assert.equal(
    isStaleLiveInteractiveCall(
      {
        type: "chat",
        status: "streaming",
        started_at: new Date(
          now - ACTIVE_CHAT_STALE_THRESHOLD_MS - 1_000
        ).toISOString(),
      },
      now
    ),
    true
  );
});

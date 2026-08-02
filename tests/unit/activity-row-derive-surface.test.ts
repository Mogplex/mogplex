import assert from "node:assert/strict";
import test from "node:test";
import { deriveSurface } from "../../lib/observability/activity-row";
import type { AiCall } from "../../lib/types";

function buildCall(overrides: Partial<AiCall> = {}): AiCall {
  return {
    id: "call-1",
    user_id: "user-1",
    type: "chat",
    model: "anthropic/claude-sonnet-4",
    input_tokens: null,
    output_tokens: null,
    cache_read_input_tokens: null,
    cache_creation_input_tokens: null,
    reasoning_tokens: null,
    gateway_generation_id: null,
    cost_source: null,
    total_tokens: null,
    cost_usd: null,
    duration_ms: null,
    started_at: "2026-04-26T12:00:00.000Z",
    completed_at: "2026-04-26T12:00:01.000Z",
    status: "success",
    error: null,
    conversation_id: null,
    job_run_id: null,
    repo_id: null,
    limit_claim_id: null,
    cancel_requested_at: null,
    control_state: "active",
    runtime_command_id: null,
    tool_calls_count: 0,
    tool_calls: [],
    metadata: {},
    sandbox_context: null,
    ...overrides,
  };
}

test("deriveSurface returns 'live' for in-flight calls regardless of metadata", () => {
  assert.equal(
    deriveSurface(
      buildCall({ status: "streaming", metadata: { source: "cli" } })
    ),
    "live"
  );
});

test("deriveSurface prefers automation marker over CLI metadata", () => {
  assert.equal(
    deriveSurface(
      buildCall({ job_run_id: "job-1", metadata: { source: "cli" } })
    ),
    "automation"
  );
});

test("deriveSurface returns 'cli' when only metadata.source = 'cli' is set", () => {
  // The OpenAI-compat CLI inference shim records calls without a
  // runtime_command_id and only stamps metadata.source = "cli". Local TUI
  // runs must still surface as CLI rather than falling back to Cloud.
  assert.equal(
    deriveSurface(buildCall({ metadata: { source: "cli" } })),
    "cli"
  );
});

test("deriveSurface returns 'cli' when both runtime_command_id and metadata.source = 'cli' are set", () => {
  assert.equal(
    deriveSurface(
      buildCall({
        runtime_command_id: "cmd-1",
        metadata: { source: "cli" },
      })
    ),
    "cli"
  );
});

test("deriveSurface returns 'cloud' for completed calls without any CLI marker", () => {
  assert.equal(deriveSurface(buildCall()), "cloud");
});

test("deriveSurface ignores unrelated metadata.source values", () => {
  assert.equal(
    deriveSurface(buildCall({ metadata: { source: "automation" } })),
    "cloud"
  );
});

test("deriveSurface tolerates malformed rows with null or omitted metadata", () => {
  assert.equal(deriveSurface(buildCall({ metadata: null as never })), "cloud");

  const { metadata: _metadata, ...callWithoutMetadata } = buildCall();
  assert.equal(deriveSurface(callWithoutMetadata as AiCall), "cloud");
});

import assert from "node:assert/strict";
import test from "node:test";
import type { UIMessage, UIMessagePart, UIDataTypes, UITools } from "ai";

type MockToolPart = UIMessagePart<UIDataTypes, UITools> & {
  type: string;
  toolName: string;
  toolCallId: string;
  state: string;
  input?: unknown;
  approval?: {
    id: string;
    approved?: boolean;
    reason?: string;
  };
  errorText?: string;
};

function createMockToolPart(overrides: Partial<MockToolPart>): MockToolPart {
  return {
    type: "dynamic-tool",
    toolName: "test_tool",
    toolCallId: "tc-123",
    state: "input-available",
    input: { foo: "bar" },
    ...overrides,
  } as MockToolPart;
}

function createMockMessage(parts: MockToolPart[]): UIMessage {
  return {
    id: "msg-1",
    role: "assistant",
    parts,
  } as unknown as UIMessage;
}

test("buildCombinedTimeline maps approval-requested tool part to approval event", async () => {
  const { buildCombinedTimeline } =
    await import("../../components/control/build-combined-timeline");

  const toolPart = createMockToolPart({
    state: "approval-requested",
    toolName: "delete_file",
    toolCallId: "tc-456",
    approval: { id: "ap-789" },
  });
  const messages = [createMockMessage([toolPart])];

  const timeline = buildCombinedTimeline([], messages);

  assert.equal(timeline.length, 1);
  const event = timeline[0];
  assert.equal(event.kind, "approval");
  assert.equal(event.label, "APPROVAL");
  if (event.kind === "approval") {
    assert.equal(event.approvalId, "ap-789");
    assert.equal(event.toolCallId, "tc-456");
    assert.equal(event.toolName, "delete_file");
    assert.equal(event.resolved, "");
    assert.ok(event.body.includes("delete_file"));
    assert.ok(event.body.includes("requires approval"));
  }
});

test("buildCombinedTimeline maps approval-responded (approved) to resolved approval event", async () => {
  const { buildCombinedTimeline } =
    await import("../../components/control/build-combined-timeline");

  const toolPart = createMockToolPart({
    state: "approval-responded",
    toolName: "git_push",
    toolCallId: "tc-abc",
    approval: { id: "ap-def", approved: true, reason: "Looks good" },
  });
  const messages = [createMockMessage([toolPart])];

  const timeline = buildCombinedTimeline([], messages);

  assert.equal(timeline.length, 1);
  const event = timeline[0];
  assert.equal(event.kind, "approval");
  if (event.kind === "approval") {
    assert.equal(event.approvalId, "ap-def");
    assert.equal(event.toolCallId, "tc-abc");
    assert.equal(event.toolName, "git_push");
    assert.equal(event.resolved, "Approved by you");
    assert.ok(event.body.includes("approved"));
  }
});

test("buildCombinedTimeline maps output-denied to resolved denied approval event", async () => {
  const { buildCombinedTimeline } =
    await import("../../components/control/build-combined-timeline");

  const toolPart = createMockToolPart({
    state: "output-denied",
    toolName: "merge_changeset",
    toolCallId: "tc-xyz",
    approval: { id: "ap-uvw", approved: false, reason: "Not ready" },
  });
  const messages = [createMockMessage([toolPart])];

  const timeline = buildCombinedTimeline([], messages);

  assert.equal(timeline.length, 1);
  const event = timeline[0];
  assert.equal(event.kind, "approval");
  if (event.kind === "approval") {
    assert.equal(event.approvalId, "ap-uvw");
    assert.equal(event.toolCallId, "tc-xyz");
    assert.equal(event.toolName, "merge_changeset");
    assert.equal(event.resolved, "Denied by you");
    assert.ok(event.body.includes("denied"));
  }
});

test("buildCombinedTimeline still maps non-approval tool parts correctly", async () => {
  const { buildCombinedTimeline } =
    await import("../../components/control/build-combined-timeline");

  const toolPart = createMockToolPart({
    state: "output-available",
    toolName: "read_file",
    toolCallId: "tc-read",
    input: { path: "/src/index.ts" },
  });
  const messages = [createMockMessage([toolPart])];

  const timeline = buildCombinedTimeline([], messages);

  assert.equal(timeline.length, 1);
  const event = timeline[0];
  assert.equal(event.kind, "tool");
  assert.equal(event.label, "TOOL");
  assert.ok(event.body.includes("read_file"));
});

test("buildCombinedTimeline maps output-error to fail event", async () => {
  const { buildCombinedTimeline } =
    await import("../../components/control/build-combined-timeline");

  const toolPart = createMockToolPart({
    state: "output-error",
    toolName: "write_file",
    toolCallId: "tc-write",
    errorText: "Permission denied",
  });
  const messages = [createMockMessage([toolPart])];

  const timeline = buildCombinedTimeline([], messages);

  assert.equal(timeline.length, 1);
  const event = timeline[0];
  assert.equal(event.kind, "fail");
  if (event.kind === "fail") {
    assert.ok(event.body.includes("write_file"));
    assert.equal(event.log, "Permission denied");
  }
});

test("buildCombinedTimeline preserves existing timeline events", async () => {
  const { buildCombinedTimeline } =
    await import("../../components/control/build-combined-timeline");

  const existingTimeline = [
    { kind: "user" as const, label: "YOU", time: "1m ago", body: "Hello" },
  ];
  const toolPart = createMockToolPart({
    state: "approval-requested",
    approval: { id: "ap-1" },
  });
  const messages = [createMockMessage([toolPart])];

  const timeline = buildCombinedTimeline(existingTimeline, messages);

  assert.equal(timeline.length, 2);
  assert.equal(timeline[0].kind, "user");
  assert.equal(timeline[1].kind, "approval");
});

import assert from "node:assert/strict";
import test from "node:test";
import { wrapToolsWithApprovalGate } from "../../lib/flows/tool-approval";
import {
  BASE_CONTEXT,
  buildDeps,
  buildTools,
  callTool,
} from "./helpers/flow-tool-approval-fixtures";

test("an approved tool call executes and persists a tool_approval wait", async () => {
  const executed: Array<{ tool: string; input: unknown }> = [];
  const { deps, record } = buildDeps({
    outcomes: [{ ok: true, output: { decision: "approve" } }],
  });
  const tools = wrapToolsWithApprovalGate(
    buildTools(executed),
    BASE_CONTEXT,
    deps
  );

  const output = await callTool(tools, "fetchFile", { path: "README.md" });

  assert.equal(output, "file contents");
  assert.deepEqual(executed, [
    { tool: "fetchFile", input: { path: "README.md" } },
  ]);
  assert.equal(record.createWaits.length, 1);
  const wait = record.createWaits[0];
  assert.equal(wait.waitKind, "tool_approval");
  assert.equal(wait.userId, "user-1");
  assert.equal(wait.jobRunId, "job-run-1");
  assert.deepEqual(wait.waitConfig, {
    kind: "tool_approval",
    toolName: "fetchFile",
    toolCallId: "fetchFile-call-1",
    toolInput: '{"path":"README.md"}',
    nodeId: "node-1",
    nodeLabel: "Review",
    agentName: "Reviewer",
    repoFullName: "acme/widgets",
  });
  assert.deepEqual(record.finalizations, [
    { waitId: "wait-1", status: "resumed" },
  ]);
});

test("an approval note is appended to string outputs and spread onto record outputs", async () => {
  const executed: Array<{ tool: string; input: unknown }> = [];
  const { deps } = buildDeps({
    outcomes: [
      { ok: true, output: { decision: "approve", note: "focus on src/" } },
      { ok: true, output: { decision: "approve", note: "then stop" } },
    ],
  });
  const tools = wrapToolsWithApprovalGate(
    buildTools(executed),
    BASE_CONTEXT,
    deps
  );

  const stringOutput = await callTool(tools, "fetchFile", { path: "a.ts" });
  assert.equal(stringOutput, "file contents\n\n[Operator note]: focus on src/");

  // Record outputs keep every original field so structured extractors (e.g.
  // updateFile commit collection) still see success/path/branch.
  const recordOutput = await callTool(tools, "updateFile", { path: "a.ts" });
  assert.deepEqual(recordOutput, {
    success: true,
    path: "src/index.ts",
    branch: "main",
    operator_note: "then stop",
  });
});

test("a denied tool call never executes and surfaces the operator note to the model", async () => {
  const executed: Array<{ tool: string; input: unknown }> = [];
  const { deps } = buildDeps({
    outcomes: [
      { ok: true, output: { decision: "deny", note: "use fetchFile instead" } },
    ],
  });
  const tools = wrapToolsWithApprovalGate(
    buildTools(executed),
    BASE_CONTEXT,
    deps
  );

  const output = (await callTool(tools, "updateFile", {
    path: "a.ts",
  })) as Record<string, unknown>;

  assert.deepEqual(executed, []);
  assert.equal(output.approved, false);
  assert.equal(output.denied_by_operator, true);
  assert.equal(output.reason, "denied");
  assert.match(String(output.message), /use fetchFile instead/);
});

test("a resume payload without an explicit approve decision is treated as a denial", async () => {
  const executed: Array<{ tool: string; input: unknown }> = [];
  const { deps } = buildDeps({
    outcomes: [{ ok: true, output: { decision: "APPROVE-ish" } }],
  });
  const tools = wrapToolsWithApprovalGate(
    buildTools(executed),
    BASE_CONTEXT,
    deps
  );

  const output = (await callTool(tools, "updateFile", {
    path: "a.ts",
  })) as Record<string, unknown>;

  assert.deepEqual(executed, []);
  assert.equal(output.approved, false);
  assert.equal(output.reason, "denied");
});

test("an unanswered approval times out as a denial and finalizes the wait as expired", async () => {
  const executed: Array<{ tool: string; input: unknown }> = [];
  const { deps, record } = buildDeps({
    outcomes: [{ ok: false, reason: "timeout", message: "no decision" }],
  });
  const tools = wrapToolsWithApprovalGate(
    buildTools(executed),
    BASE_CONTEXT,
    deps
  );

  const output = (await callTool(tools, "fetchFile", {
    path: "a.ts",
  })) as Record<string, unknown>;

  assert.deepEqual(executed, []);
  assert.equal(output.approved, false);
  assert.equal(output.denied_by_operator, false);
  assert.equal(output.reason, "timeout");
  assert.deepEqual(record.finalizations, [
    { waitId: "wait-1", status: "expired" },
  ]);
});

test("tools without an execute function pass through the gate untouched", () => {
  const { deps } = buildDeps({ outcomes: [] });
  const original = buildTools([]);
  const tools = wrapToolsWithApprovalGate(original, BASE_CONTEXT, deps);
  assert.equal(tools.providerExecuted, original.providerExecuted);
});

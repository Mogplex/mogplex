import assert from "node:assert/strict";
import test from "node:test";
import {
  TOOL_APPROVAL_WAIT_BUDGET_MS,
  wrapToolsWithApprovalGate,
  type ToolApprovalDeps,
} from "../../lib/flows/tool-approval";
import type { ToolSet } from "ai";
import {
  BASE_CONTEXT,
  buildDeps,
  buildTools,
  callTool,
} from "./helpers/flow-tool-approval-fixtures";

test("once the shared wait budget is exhausted, later calls are denied without creating a wait", async () => {
  const executed: Array<{ tool: string; input: unknown }> = [];
  const { deps, record } = buildDeps({
    outcomes: [{ ok: false, reason: "timeout", message: "no decision" }],
    // The first wait burns the whole budget.
    elapsedPerWaitMs: TOOL_APPROVAL_WAIT_BUDGET_MS,
  });
  const tools = wrapToolsWithApprovalGate(
    buildTools(executed),
    BASE_CONTEXT,
    deps
  );

  await callTool(tools, "fetchFile", { path: "a.ts" });
  const second = (await callTool(tools, "updateFile", {
    path: "b.ts",
  })) as Record<string, unknown>;

  assert.deepEqual(executed, []);
  assert.equal(second.approved, false);
  assert.equal(second.reason, "budget_exhausted");
  assert.equal(record.createWaits.length, 1, "no wait row for the second call");
});

test("the wait budget is shared across separate gated loops of the same node run", async () => {
  const executed: Array<{ tool: string; input: unknown }> = [];
  const { deps, record } = buildDeps({
    outcomes: [
      { ok: false, reason: "timeout", message: "no decision" },
      { ok: true, output: { decision: "approve" } },
    ],
  });

  // First gated loop (e.g. the review phase) burns the whole budget on an
  // unanswered wait.
  const reviewTools = wrapToolsWithApprovalGate(
    buildTools(executed),
    BASE_CONTEXT,
    deps
  );
  await callTool(reviewTools, "fetchFile", { path: "a.ts" });

  // A second wrap for the same job run + node (e.g. the autofix phase) must
  // NOT get a fresh 10-minute window: its calls deny immediately.
  const fixTools = wrapToolsWithApprovalGate(
    buildTools(executed),
    BASE_CONTEXT,
    deps
  );
  const fixOutput = (await callTool(fixTools, "updateFile", {
    path: "b.ts",
  })) as Record<string, unknown>;

  assert.deepEqual(executed, []);
  assert.equal(fixOutput.approved, false);
  assert.equal(fixOutput.reason, "budget_exhausted");
  assert.equal(
    record.createWaits.length,
    1,
    "the fix loop must not create a second wait"
  );

  // A different node keeps its own budget: its wait goes through and an
  // approval executes the tool.
  const otherNodeTools = wrapToolsWithApprovalGate(
    buildTools(executed),
    { ...BASE_CONTEXT, nodeId: "node-2" },
    deps
  );
  const otherOutput = await callTool(otherNodeTools, "fetchFile", {
    path: "c.ts",
  });
  assert.equal(otherOutput, "file contents");
  assert.equal(record.createWaits.length, 2);
});

test("fallback call ids never collide across wrapped loops of the same node run", async () => {
  const executed: Array<{ tool: string; input: unknown }> = [];
  const { deps } = buildDeps({
    outcomes: [
      { ok: true, output: { decision: "approve" } },
      { ok: true, output: { decision: "approve" } },
    ],
  });

  const idempotencyKeys: string[] = [];
  const createToken = deps.waitProvider.createToken;
  deps.waitProvider = {
    ...deps.waitProvider,
    createToken: async (input) => {
      idempotencyKeys.push(input.idempotencyKey);
      return createToken(input);
    },
  };

  // Two separate wrappers for the same node run (review loop, then fix
  // loop), each calling the same tool WITHOUT a toolCallId from the SDK.
  const reviewTools = wrapToolsWithApprovalGate(
    buildTools(executed),
    BASE_CONTEXT,
    deps
  );
  const fixTools = wrapToolsWithApprovalGate(
    buildTools(executed),
    BASE_CONTEXT,
    deps
  );

  const call = (tools: ToolSet) =>
    (
      tools.fetchFile.execute as (
        input: unknown,
        options: unknown
      ) => Promise<unknown>
    )({ path: "a.ts" }, { messages: [] });

  await call(reviewTools);
  await call(fixTools);

  assert.equal(idempotencyKeys.length, 2);
  assert.notEqual(
    idempotencyKeys[0],
    idempotencyKeys[1],
    "the fix loop's first fallback call must not reuse the review loop's wait token"
  );
});

test("a wait is capped to the enclosing loop's remaining generation window", async () => {
  const executed: Array<{ tool: string; input: unknown }> = [];
  const { deps, record } = buildDeps({
    outcomes: [{ ok: false, reason: "timeout", message: "no decision" }],
  });
  // A 3-minute generation window leaves 2 minutes after the 60s margin —
  // far less than the 10-minute budget.
  deps.generationTimeoutMs = 3 * 60_000;

  const tokenTimeouts: Array<number | null> = [];
  const createToken = deps.waitProvider.createToken;
  deps.waitProvider = {
    ...deps.waitProvider,
    createToken: async (input) => {
      tokenTimeouts.push(input.timeoutMs);
      return createToken(input);
    },
  };

  const tools = wrapToolsWithApprovalGate(
    buildTools(executed),
    BASE_CONTEXT,
    deps
  );
  const output = (await callTool(tools, "fetchFile", {
    path: "a.ts",
  })) as Record<string, unknown>;

  assert.equal(output.reason, "timeout");
  assert.deepEqual(tokenTimeouts, [2 * 60_000]);
  // Only the capped wait is charged, not the full budget: a later gated loop
  // (with its own deadline) still has the rest.
  const secondLoopTools = wrapToolsWithApprovalGate(
    buildTools(executed),
    BASE_CONTEXT,
    { ...deps, generationTimeoutMs: undefined }
  );
  await callTool(secondLoopTools, "fetchFile", { path: "b.ts" }).catch(
    () => null
  );
  assert.equal(
    record.createWaits.length,
    2,
    "the second loop must still be able to open a wait from the remaining budget"
  );
});

test("a nearly-exhausted generation window denies immediately without a wait", async () => {
  const executed: Array<{ tool: string; input: unknown }> = [];
  const { deps, record } = buildDeps({ outcomes: [] });
  // 70s window minus the 60s margin leaves 10s — below the minimum useful
  // wait, so the gate must deny without touching the wait infrastructure.
  deps.generationTimeoutMs = 70_000;

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
  assert.equal(output.reason, "deadline");
  assert.match(String(output.message), /execution deadline/);
  assert.equal(record.createWaits.length, 0);
});

test("the same provider toolCallId in two gated loops requires two independent decisions", async () => {
  const executed: Array<{ tool: string; input: unknown }> = [];
  const { deps, record } = buildDeps({
    outcomes: [
      { ok: true, output: { decision: "approve" } },
      { ok: true, output: { decision: "deny" } },
    ],
  });

  const idempotencyKeys: string[] = [];
  const createToken = deps.waitProvider.createToken;
  deps.waitProvider = {
    ...deps.waitProvider,
    createToken: async (input) => {
      idempotencyKeys.push(input.idempotencyKey);
      return createToken(input);
    },
  };

  // Two separate gated loops (review, then fix) whose models emit the SAME
  // provider toolCallId — realistic for providers with generation-scoped ids.
  const reviewTools = wrapToolsWithApprovalGate(
    buildTools(executed),
    BASE_CONTEXT,
    deps
  );
  const fixTools = wrapToolsWithApprovalGate(
    buildTools(executed),
    BASE_CONTEXT,
    deps
  );

  const first = (await callTool(
    reviewTools,
    "updateFile",
    { path: "a.ts" },
    "call_1"
  )) as Record<string, unknown>;
  const second = (await callTool(
    fixTools,
    "updateFile",
    { path: "DANGEROUS-different-input.ts" },
    "call_1"
  )) as Record<string, unknown>;

  // Each loop went through its own wait and its own decision: the first was
  // approved and ran; the second was denied and must NOT have executed by
  // replaying the first approval.
  assert.equal(record.createWaits.length, 2);
  assert.equal(idempotencyKeys.length, 2);
  assert.notEqual(
    idempotencyKeys[0],
    idempotencyKeys[1],
    "identical provider toolCallIds must not share a wait token across loops"
  );
  assert.deepEqual(executed, [{ tool: "updateFile", input: { path: "a.ts" } }]);
  assert.equal(first.success, true);
  assert.equal(second.approved, false);
  assert.equal(second.reason, "denied");
});

test("concurrent tool calls cannot overdraw the shared wait budget", async () => {
  const executed: Array<{ tool: string; input: unknown }> = [];
  const rows: Array<{ createdAtMs: number; expiresAtMs: number }> = [];
  const record = { createWaits: 0 };
  let clock = 1_000_000;
  let releaseFirstWait: (() => void) | null = null;

  const deps: ToolApprovalDeps = {
    now: () => clock,
    loadSpentWaitMs: async () =>
      rows.reduce(
        (total, row) => total + Math.max(0, row.expiresAtMs - row.createdAtMs),
        0
      ),
    waitProvider: {
      sleep: async () => {},
      createToken: async ({ idempotencyKey }) => ({ id: idempotencyKey }),
      waitForToken: async <T>() => {
        // Stay pending until the test releases it, so the second call runs
        // while the first wait is genuinely outstanding.
        await new Promise<void>((resolve) => {
          releaseFirstWait = resolve;
        });
        return {
          ok: false,
          reason: "timeout",
          message: "no decision",
        } as never as { ok: true; output: T };
      },
    },
    waitStore: {
      createWait: async (input) => {
        record.createWaits += 1;
        rows.push({
          createdAtMs: clock,
          expiresAtMs: input.expiresAt?.getTime() ?? clock,
        });
        return { id: `wait-${record.createWaits}` };
      },
      finalizeWait: async () => {},
    },
  };

  const tools = wrapToolsWithApprovalGate(
    buildTools(executed),
    BASE_CONTEXT,
    deps
  );
  const exec = tools.fetchFile.execute as (
    input: unknown,
    options: unknown
  ) => Promise<Record<string, unknown>>;

  // Launch both calls concurrently, as the AI SDK does for parallel tool
  // calls within one step.
  const first = exec({ path: "a.ts" }, { toolCallId: "call-1", messages: [] });
  const second = exec({ path: "b.ts" }, { toolCallId: "call-2", messages: [] });

  const secondOutput = await second;
  // The second call observed the first call's full reservation and denied —
  // total reserved never exceeds the budget.
  assert.equal(secondOutput.approved, false);
  assert.equal(secondOutput.reason, "budget_exhausted");
  assert.equal(record.createWaits, 1);
  const totalReservedMs = rows.reduce(
    (total, row) => total + (row.expiresAtMs - row.createdAtMs),
    0
  );
  assert.ok(totalReservedMs <= TOOL_APPROVAL_WAIT_BUDGET_MS);

  clock += TOOL_APPROVAL_WAIT_BUDGET_MS;
  assert.ok(releaseFirstWait, "first wait must be pending");
  (releaseFirstWait as unknown as () => void)();
  const firstOutput = await first;
  assert.equal(firstOutput.reason, "timeout");
  assert.deepEqual(executed, []);
});

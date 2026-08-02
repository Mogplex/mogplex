import assert from "node:assert/strict";
import test from "node:test";
import {
  TOOL_APPROVAL_WAIT_BUDGET_MS,
  resolveToolApprovalContext,
  wrapToolsWithApprovalGate,
  type ToolApprovalContext,
  type ToolApprovalDeps,
} from "../../lib/flows/tool-approval";
import type { ToolSet } from "ai";

const BASE_CONTEXT: ToolApprovalContext = {
  userId: "user-1",
  jobRunId: "job-run-1",
  flowId: "flow-1",
  flowVersionId: "flow-version-1",
  installationId: 42,
  repoId: "repo-1",
  repoFullName: "acme/widgets",
  nodeId: "node-1",
  nodeLabel: "Review",
  agentName: "Reviewer",
};

type WaitRecord = {
  createWaits: Array<Record<string, unknown>>;
  finalizations: Array<{ waitId: string; status: string }>;
};

// Mirrors the durable accounting in loadToolApprovalSpentWaitMs: resumed
// waits charge actual waiting time, everything else charges its full
// reserved window (expires_at − created_at). The fake "rows" live in the
// record, so budget state flows through persistence exactly as in prod —
// there is deliberately no in-memory budget to leak between loops.
function buildDeps(options: {
  outcomes: Array<
    | { ok: true; output: { decision?: unknown; note?: unknown } }
    | { ok: false; reason: "timeout"; message: string }
  >;
  elapsedPerWaitMs?: number;
}): { deps: ToolApprovalDeps; record: WaitRecord } {
  const record: WaitRecord = { createWaits: [], finalizations: [] };
  const rows: Array<{
    key: string;
    createdAtMs: number;
    expiresAtMs: number;
    resumedAtMs: number | null;
  }> = [];
  let clock = 1_000_000;
  let tokenCounter = 0;
  let outcomeIndex = 0;
  let pendingRow: (typeof rows)[number] | null = null;
  const deps: ToolApprovalDeps = {
    now: () => clock,
    loadSpentWaitMs: async ({ jobRunId, nodeId }) => {
      const key = `${jobRunId}:${nodeId}`;
      return rows
        .filter((row) => row.key === key)
        .reduce(
          (total, row) =>
            total +
            Math.max(0, (row.resumedAtMs ?? row.expiresAtMs) - row.createdAtMs),
          0
        );
    },
    waitProvider: {
      sleep: async () => {},
      createToken: async ({ idempotencyKey }) => {
        tokenCounter += 1;
        return { id: `token-${tokenCounter}:${idempotencyKey}` };
      },
      waitForToken: async <T>() => {
        clock += options.elapsedPerWaitMs ?? 1_000;
        const outcome = options.outcomes[outcomeIndex];
        outcomeIndex += 1;
        assert.ok(outcome, "waitForToken called more times than outcomes");
        if (outcome.ok && pendingRow) {
          // resumeFlowWait stamps resumed_at before the token completes.
          pendingRow.resumedAtMs = clock;
        }
        pendingRow = null;
        return outcome as
          | { ok: true; output: T }
          | { ok: false; reason: "timeout"; message: string };
      },
    },
    waitStore: {
      createWait: async (input) => {
        record.createWaits.push(input as unknown as Record<string, unknown>);
        const row = {
          key: `${input.jobRunId}:${input.nodeId}`,
          createdAtMs: clock,
          expiresAtMs: input.expiresAt?.getTime() ?? clock,
          resumedAtMs: null,
        };
        rows.push(row);
        pendingRow = row;
        return { id: `wait-${record.createWaits.length}` };
      },
      finalizeWait: async ({ waitId, status }) => {
        record.finalizations.push({ waitId, status });
      },
    },
  };
  return { deps, record };
}

function buildTools(executed: Array<{ tool: string; input: unknown }>) {
  return {
    fetchFile: {
      description: "Fetch a file",
      execute: async (input: unknown) => {
        executed.push({ tool: "fetchFile", input });
        return "file contents";
      },
    },
    updateFile: {
      description: "Update a file",
      execute: async (input: unknown) => {
        executed.push({ tool: "updateFile", input });
        return { success: true, path: "src/index.ts", branch: "main" };
      },
    },
    providerExecuted: {
      description: "No execute function",
    },
  } as unknown as ToolSet;
}

async function callTool(
  tools: ToolSet,
  name: string,
  input: unknown,
  toolCallId = `${name}-call-1`
) {
  const execute = tools[name]?.execute;
  assert.equal(typeof execute, "function");
  return (execute as (input: unknown, options: unknown) => Promise<unknown>)(
    input,
    { toolCallId, messages: [] }
  );
}

test("resolveToolApprovalContext returns null unless the node opted in with full flow identifiers", () => {
  const repo = {
    id: "repo-1",
    user_id: "user-1",
    full_name: "acme/widgets",
    github_installation_id: 42,
  };
  const agent = { name: "Reviewer" };

  assert.equal(resolveToolApprovalContext({ metadata: {}, agent, repo }), null);
  // Opted-in but incomplete metadata must fail the node, never silently run
  // the tools ungated.
  assert.throws(
    () =>
      resolveToolApprovalContext({
        metadata: { flow_require_approval: true, flow_id: "flow-1" },
        agent,
        repo,
      }),
    /refusing to execute tools without the gate/
  );

  const context = resolveToolApprovalContext({
    metadata: {
      flow_require_approval: true,
      flow_job_run_id: "job-run-1",
      flow_id: "flow-1",
      flow_version_id: "flow-version-1",
      flow_node_id: "node-1",
      flow_node_label: "Review",
    },
    agent,
    repo,
  });
  assert.deepEqual(context, BASE_CONTEXT);
});

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

test("tools without an execute function pass through the gate untouched", () => {
  const { deps } = buildDeps({ outcomes: [] });
  const original = buildTools([]);
  const tools = wrapToolsWithApprovalGate(original, BASE_CONTEXT, deps);
  assert.equal(tools.providerExecuted, original.providerExecuted);
});

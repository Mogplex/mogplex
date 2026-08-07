/**
 * Shared fixtures for flow-tool-approval tests.
 */
import type { ToolSet } from "ai";
import type {
  ToolApprovalContext,
  ToolApprovalDeps,
} from "../../../lib/flows/tool-approval";
import assert from "node:assert/strict";

export const BASE_CONTEXT: ToolApprovalContext = {
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

export type WaitRecord = {
  createWaits: Array<Record<string, unknown>>;
  finalizations: Array<{ waitId: string; status: string }>;
};

// Mirrors the durable accounting in loadToolApprovalSpentWaitMs: resumed
// waits charge actual waiting time, everything else charges its full
// reserved window (expires_at − created_at). The fake "rows" live in the
// record, so budget state flows through persistence exactly as in prod —
// there is deliberately no in-memory budget to leak between loops.
export function buildDeps(options: {
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

export function buildTools(executed: Array<{ tool: string; input: unknown }>) {
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

export async function callTool(
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

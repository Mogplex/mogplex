import assert from "node:assert/strict";
import test from "node:test";
import type { FlowRunDetail } from "../../lib/types";
import {
  collectRunEditDiffs,
  MAX_RUN_EDIT_DIFFS,
} from "../../lib/flows/run-presentation";

test("collectRunEditDiffs extracts updateFile commits from run tool calls", () => {
  const patch = [
    "diff --git a/src/widget.ts b/src/widget.ts",
    "index 1111111..2222222 100644",
    "--- a/src/widget.ts",
    "+++ b/src/widget.ts",
    "@@ -1 +1 @@",
    "-export const value = 1",
    "+export const value = 2",
  ].join("\n");

  const run = {
    node_runs: [
      {
        id: "node-run-1",
        node_id: "agent-1",
        node_label: "Fixer",
        output: {
          tool_calls: [
            {
              name: "updateFile",
              input: { path: "src/widget.ts" },
              output: {
                success: true,
                path: "src/widget.ts",
                branch: "fix/widgets",
                commitSha: "abcdef1234567890",
                commitUrl: "https://github.com/acme/widgets/commit/abcdef1",
                patch,
              },
            },
          ],
        },
      },
    ],
    ai_calls: [
      {
        id: "call-1",
        model: "minimax/minimax-m2.7",
        tool_calls: [
          {
            name: "updateFile",
            input: { path: "src/widget.ts" },
            output: {
              success: true,
              path: "src/widget.ts",
              commitSha: "abcdef1234567890",
              commitUrl: "https://github.com/acme/widgets/commit/abcdef1",
            },
          },
          {
            name: "reportFix",
            input: { applied: true },
            output: { applied: true },
          },
        ],
      },
    ],
  } as unknown as FlowRunDetail;

  assert.deepEqual(collectRunEditDiffs(run), [
    {
      id: "abcdef1234567890",
      sourceLabel: "Fixer",
      path: "src/widget.ts",
      branch: "fix/widgets",
      commitSha: "abcdef1234567890",
      commitUrl: "https://github.com/acme/widgets/commit/abcdef1",
      patch,
    },
  ]);
});

test("collectRunEditDiffs ignores incomplete updateFile calls", () => {
  const run = {
    node_runs: [
      {
        id: "node-run-1",
        node_id: "agent-1",
        node_label: "Fixer",
        output: {
          tool_calls: [
            {
              name: "updateFile",
              input: { path: "src/pending.ts" },
            },
            {
              name: "updateFile",
              input: { path: "src/failed.ts" },
              output: {
                success: false,
                path: "src/failed.ts",
                commitSha: "failed123",
              },
            },
            {
              name: "updateFile",
              input: { path: "src/degraded.ts" },
              output: {
                path: "src/degraded.ts",
                commitSha: "degraded123",
              },
            },
          ],
        },
      },
    ],
    ai_calls: [],
  } as unknown as FlowRunDetail;

  assert.deepEqual(collectRunEditDiffs(run), [
    {
      id: "degraded123",
      sourceLabel: "Fixer",
      path: "src/degraded.ts",
      branch: null,
      commitSha: "degraded123",
      commitUrl: null,
      patch: null,
    },
  ]);
});

test("collectRunEditDiffs caps large edit lists", () => {
  const run = {
    node_runs: [
      {
        id: "node-run-1",
        node_id: "agent-1",
        node_label: "Fixer",
        output: {
          tool_calls: Array.from(
            { length: MAX_RUN_EDIT_DIFFS + 2 },
            (_, index) => ({
              name: "updateFile",
              input: { path: `src/file-${index}.ts` },
              output: {
                success: true,
                path: `src/file-${index}.ts`,
                commitSha: `commit-${index}`,
              },
            })
          ),
        },
      },
    ],
    ai_calls: [],
  } as unknown as FlowRunDetail;

  const edits = collectRunEditDiffs(run);
  assert.equal(edits.length, MAX_RUN_EDIT_DIFFS);
  assert.equal(edits.at(-1)?.commitSha, `commit-${MAX_RUN_EDIT_DIFFS - 1}`);
});

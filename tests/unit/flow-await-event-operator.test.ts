import assert from "node:assert/strict";
import test from "node:test";
import { awaitEventOperator } from "../../lib/flows/operators/await-event";
import type {
  FlowOperatorExecuteContext,
  FlowOperatorWaitProvider,
} from "../../lib/flows/operators/types";
import type { FlowNode } from "../../lib/types";

type AwaitNode = Extract<FlowNode, { type: "await_event" }>;

function buildContext(input: {
  node: AwaitNode;
  resumeOutput: Record<string, unknown>;
  resolutionState?: Record<string, unknown>;
  onCreateWait?: (
    wait: Parameters<
      FlowOperatorExecuteContext<AwaitNode>["waitStore"]["createWait"]
    >[0]
  ) => void;
  onComplete?: (
    completion: Parameters<
      FlowOperatorExecuteContext<AwaitNode>["completeNodeRun"]
    >[0]
  ) => void;
}): FlowOperatorExecuteContext<AwaitNode> {
  const waitProvider: FlowOperatorWaitProvider = {
    sleep: async () => {},
    createToken: async () => ({ id: "token-1" }),
    waitForToken: async <T>() => ({
      ok: true,
      output: input.resumeOutput as T,
    }),
  };

  return {
    node: input.node,
    label: input.node.data.label,
    graph: {
      nodes: [input.node],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    },
    inboundTokens: [],
    activeInboundTokens: [],
    shouldSkip: false,
    outputs: new Map(),
    flowState: new Map(),
    resolutionState: input.resolutionState ?? {
      metadata: { head_sha: "abc123" },
      repo: { id: "repo-1", full_name: "acme/widgets" },
    },
    predecessorOutputs: () => [],
    emit: (_label, _text, options) => [
      {
        targetId: "end",
        token: {
          fromNodeId: input.node.id,
          label: input.node.data.label,
          text: "resumed",
          skipped: false,
          payload: options?.payload,
        },
      },
    ],
    completeNodeRun: async (completion) => {
      input.onComplete?.(completion);
      return 1;
    },
    completeSkipped: async () => ({ ok: true, emitted: [] }),
    jobRunId: "job-1",
    flowId: "flow-1",
    flowVersionId: "version-1",
    userId: "user-1",
    installationId: 99,
    repoId: "repo-1",
    waitProvider,
    waitStore: {
      createWait: async (wait) => {
        input.onCreateWait?.(wait);
        return { id: "wait-1" };
      },
      finalizeWait: async () => {},
    },
    actionRunner: async () => ({ summary: "", output: {} }),
  };
}

test("await_event persists the triggering SHA for CI correlation", async () => {
  const node: AwaitNode = {
    id: "await-ci",
    type: "await_event",
    position: { x: 0, y: 0 },
    data: {
      label: "Wait for CI",
      config: {
        kind: "ci_workflow_completed",
        workflowName: "CI / test",
        conclusion: "success",
        matchTriggerSha: true,
      },
      timeout: { value: 30, unit: "minutes" },
    },
  };
  let persistedConfig: unknown = null;

  const result = await awaitEventOperator.execute!(
    buildContext({
      node,
      resumeOutput: { conclusion: "success" },
      onCreateWait: (wait) => {
        persistedConfig = wait.waitConfig;
      },
    })
  );

  assert.equal(result.ok, true);
  assert.deepEqual(persistedConfig, {
    kind: "ci_workflow_completed",
    workflowName: "CI / test",
    conclusion: "success",
    matchTriggerSha: true,
    expectedSha: "abc123",
  });
});

test("await_event persists the triggering issue for GitHub comment correlation", async () => {
  const node: AwaitNode = {
    id: "await-comment",
    type: "await_event",
    position: { x: 0, y: 0 },
    data: {
      label: "Wait for approval comment",
      config: {
        kind: "github_comment_added",
        bodyContains: "approved",
        authorLogin: "alice",
        prOnly: true,
        matchTriggerIssue: true,
      },
      timeout: { value: 24, unit: "hours" },
    },
  };
  let persistedConfig: unknown = null;

  const result = await awaitEventOperator.execute!(
    buildContext({
      node,
      resumeOutput: { comment: { body: "Approved" } },
      resolutionState: {
        metadata: { pr_number: 42 },
        repo: { id: "repo-1", full_name: "acme/widgets" },
      },
      onCreateWait: (wait) => {
        persistedConfig = wait.waitConfig;
      },
    })
  );

  assert.equal(result.ok, true);
  assert.deepEqual(persistedConfig, {
    kind: "github_comment_added",
    bodyContains: "approved",
    authorLogin: "alice",
    prOnly: true,
    matchTriggerIssue: true,
    expectedIssueNumber: 42,
  });
});

test("await_event fails closed when a comment wait cannot resolve its triggering issue", async () => {
  const node: AwaitNode = {
    id: "await-comment",
    type: "await_event",
    position: { x: 0, y: 0 },
    data: {
      label: "Wait for a comment",
      config: {
        kind: "github_comment_added",
        bodyContains: "",
        authorLogin: "",
        prOnly: true,
        matchTriggerIssue: true,
      },
      timeout: null,
    },
  };
  const completions: Array<{ status: string; error?: string | null }> = [];
  let createdWait = false;

  const result = await awaitEventOperator.execute!(
    buildContext({
      node,
      resumeOutput: {},
      resolutionState: {
        metadata: {},
        repo: { id: "repo-1", full_name: "acme/widgets" },
      },
      onCreateWait: () => {
        createdWait = true;
      },
      onComplete: (completion) => completions.push(completion),
    })
  );

  assert.equal(result.ok, false);
  assert.equal(createdWait, false);
  assert.equal(completions.at(-1)?.status, "failed");
  assert.match(completions.at(-1)?.error ?? "", /triggering issue/);
});

test("manual approval denial fails the await node", async () => {
  const node: AwaitNode = {
    id: "await-approval",
    type: "await_event",
    position: { x: 0, y: 0 },
    data: {
      label: "Ship production",
      config: {
        kind: "manual_approval",
        prompt: "Approve production deployment",
      },
      timeout: { value: 24, unit: "hours" },
    },
  };
  const completions: Array<{ status: string; error?: string | null }> = [];

  const result = await awaitEventOperator.execute!(
    buildContext({
      node,
      resumeOutput: { decision: "deny", note: "Hold release" },
      onComplete: (completion) => completions.push(completion),
    })
  );

  assert.deepEqual(result, {
    ok: false,
    message: 'Await "Ship production" was denied',
  });
  assert.equal(completions.at(-1)?.status, "failed");
  assert.match(completions.at(-1)?.error ?? "", /denied/);
});

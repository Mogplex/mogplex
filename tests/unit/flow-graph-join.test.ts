import assert from "node:assert/strict";
import test from "node:test";
import { coerceGraph, validateFlowGraph } from "../../lib/flows/graph";
import { joinOperator } from "../../lib/flows/operators/join";
import {
  buildExecuteContext,
  buildJoinPolicyGraph,
  buildJoinTestGraph,
  makeToken,
} from "./helpers/flow-graph-fixtures";

test("validateFlowGraph accepts wait_for_any join policy", () => {
  const graph = buildJoinPolicyGraph({
    label: "Merge",
    policy: "wait_for_any",
  });
  const validation = validateFlowGraph(graph);
  assert.equal(validation.valid, true, validation.errors.join("\n"));
});

test("validateFlowGraph accepts quorum policy with valid threshold", () => {
  const graph = buildJoinPolicyGraph({
    label: "Merge",
    policy: "quorum",
    quorum: 2,
  });
  const validation = validateFlowGraph(graph);
  assert.equal(validation.valid, true, validation.errors.join("\n"));
});

test("validateFlowGraph rejects quorum policy without a quorum threshold", () => {
  const graph = buildJoinPolicyGraph({ label: "Merge", policy: "quorum" });
  const validation = validateFlowGraph(graph);
  assert.equal(validation.valid, false);
  assert.ok(
    validation.errors.some((error) => error.includes("quorum policy")),
    `expected quorum threshold error; got: ${validation.errors.join(", ")}`
  );
});

test("validateFlowGraph rejects quorum smaller than 2", () => {
  const graph = buildJoinPolicyGraph({
    label: "Merge",
    policy: "quorum",
    quorum: 1,
  });
  const validation = validateFlowGraph(graph);
  assert.equal(validation.valid, false);
  assert.ok(
    validation.errors.some((error) => error.includes("at least 2")),
    `expected 'at least 2' error; got: ${validation.errors.join(", ")}`
  );
});

test("validateFlowGraph rejects quorum greater than inbound edge count", () => {
  const graph = buildJoinPolicyGraph({
    label: "Merge",
    policy: "quorum",
    quorum: 5,
  });
  const validation = validateFlowGraph(graph);
  assert.equal(validation.valid, false);
  assert.ok(
    validation.errors.some((error) => error.includes("cannot exceed")),
    `expected 'cannot exceed' error; got: ${validation.errors.join(", ")}`
  );
});

test("coerceGraph defaults a missing join policy to wait_for_all and clears quorum", () => {
  const graph = coerceGraph({
    nodes: [
      {
        id: "start",
        type: "start",
        position: { x: 0, y: 0 },
        data: { label: "PR", event: "pr_opened" },
      },
      {
        id: "join",
        type: "join",
        position: { x: 0, y: 0 },
        data: { label: "Merge", quorum: 99 },
      },
      {
        id: "end",
        type: "end",
        position: { x: 0, y: 0 },
        data: { label: "Done" },
      },
    ],
    edges: [],
  });
  const join = graph.nodes.find((node) => node.type === "join");
  assert.ok(join);
  assert.equal(join.data.policy, "wait_for_all");
  assert.equal(join.data.quorum, null);
});

test("coerceGraph preserves quorum policy and threshold", () => {
  const graph = coerceGraph({
    nodes: [
      {
        id: "join",
        type: "join",
        position: { x: 0, y: 0 },
        data: { label: "Merge", policy: "quorum", quorum: 3 },
      },
    ],
    edges: [],
  });
  const join = graph.nodes.find((node) => node.type === "join");
  assert.ok(join);
  assert.equal(join.data.policy, "quorum");
  assert.equal(join.data.quorum, 3);
});

test("join.isReady: wait_for_all only fires once every inbound has arrived", () => {
  const { joinNode } = buildJoinTestGraph("wait_for_all", null, 3);
  assert.equal(
    joinOperator.isReady!({
      node: joinNode,
      incomingCount: 3,
      receivedTokens: [makeToken("branch-0", "Branch 0")],
    }),
    false
  );
  assert.equal(
    joinOperator.isReady!({
      node: joinNode,
      incomingCount: 3,
      receivedTokens: [
        makeToken("branch-0", "Branch 0"),
        makeToken("branch-1", "Branch 1"),
        makeToken("branch-2", "Branch 2"),
      ],
    }),
    true
  );
});

test("join.isReady: wait_for_any flips true on the first active token", () => {
  const { joinNode } = buildJoinTestGraph("wait_for_any", null, 3);
  // First arrival is skipped - not enough yet, but must wait for actives.
  assert.equal(
    joinOperator.isReady!({
      node: joinNode,
      incomingCount: 3,
      receivedTokens: [makeToken("branch-0", "Branch 0", true)],
    }),
    false
  );
  // First active arrival flips ready.
  assert.equal(
    joinOperator.isReady!({
      node: joinNode,
      incomingCount: 3,
      receivedTokens: [
        makeToken("branch-0", "Branch 0", true),
        makeToken("branch-1", "Branch 1"),
      ],
    }),
    true
  );
  // All-skipped fall-through still flips ready (so the join can emit skipped).
  assert.equal(
    joinOperator.isReady!({
      node: joinNode,
      incomingCount: 3,
      receivedTokens: [
        makeToken("branch-0", "Branch 0", true),
        makeToken("branch-1", "Branch 1", true),
        makeToken("branch-2", "Branch 2", true),
      ],
    }),
    true
  );
});

test("join.isReady: quorum fires at the Nth active token", () => {
  const { joinNode } = buildJoinTestGraph("quorum", 2, 3);
  // 1 active + 1 skipped is not enough.
  assert.equal(
    joinOperator.isReady!({
      node: joinNode,
      incomingCount: 3,
      receivedTokens: [
        makeToken("branch-0", "Branch 0"),
        makeToken("branch-1", "Branch 1", true),
      ],
    }),
    false
  );
  // 2 active actives meets quorum.
  assert.equal(
    joinOperator.isReady!({
      node: joinNode,
      incomingCount: 3,
      receivedTokens: [
        makeToken("branch-0", "Branch 0"),
        makeToken("branch-1", "Branch 1"),
      ],
    }),
    true
  );
});

test("join.isReady: quorum becomes ready when the threshold is unreachable", () => {
  const { joinNode } = buildJoinTestGraph("quorum", 2, 3);
  // 1 active + 2 skipped, no remaining -> unreachable, fire to skip.
  assert.equal(
    joinOperator.isReady!({
      node: joinNode,
      incomingCount: 3,
      receivedTokens: [
        makeToken("branch-0", "Branch 0"),
        makeToken("branch-1", "Branch 1", true),
        makeToken("branch-2", "Branch 2", true),
      ],
    }),
    true
  );
});

test("join.execute: wait_for_all writes active/skipped/pending labels", async () => {
  const { graph, joinNode } = buildJoinTestGraph("wait_for_all", null, 2);
  const tokens = [
    makeToken("branch-0", "Branch 0"),
    makeToken("branch-1", "Branch 1"),
  ];
  const { ctx, completed, emitted } = buildExecuteContext(
    graph,
    joinNode,
    tokens
  );
  const result = await joinOperator.execute!(ctx);

  assert.equal(result.ok, true);
  assert.equal(completed.length, 1);
  assert.equal(completed[0].status, "success");
  assert.deepEqual(completed[0].output, {
    policy: "wait_for_all",
    active_from: ["Branch 0", "Branch 1"],
    skipped_from: [],
    pending_from: [],
    emitted_after: 2,
    reason: "policy_satisfied",
  });
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].targetId, "end");
  assert.equal(emitted[0].token.skipped, false);
});

test("join.execute: wait_for_all with all branches skipped emits skipped downstream", async () => {
  const { graph, joinNode } = buildJoinTestGraph("wait_for_all", null, 2);
  const tokens = [
    makeToken("branch-0", "Branch 0", true),
    makeToken("branch-1", "Branch 1", true),
  ];
  const { ctx, completed, emitted } = buildExecuteContext(
    graph,
    joinNode,
    tokens
  );
  await joinOperator.execute!(ctx);

  assert.equal(completed.length, 1);
  assert.equal(completed[0].status, "skipped");
  assert.equal(completed[0].output!.reason, "all_skipped");
  assert.deepEqual(completed[0].output!.skipped_from, ["Branch 0", "Branch 1"]);
  assert.equal(emitted[0].token.skipped, true);
});

test("join.execute: wait_for_any emits success on first active arrival and lists pending branches", async () => {
  const { graph, joinNode } = buildJoinTestGraph("wait_for_any", null, 3);
  // Only branch-0 has arrived (active). branch-1 and branch-2 are still pending.
  const tokens = [makeToken("branch-0", "Branch 0")];
  const { ctx, completed, emitted } = buildExecuteContext(
    graph,
    joinNode,
    tokens
  );
  await joinOperator.execute!(ctx);

  assert.equal(completed.length, 1);
  assert.equal(completed[0].status, "success");
  const output = completed[0].output!;
  assert.equal(output.policy, "wait_for_any");
  assert.equal(output.reason, "policy_satisfied");
  assert.deepEqual(output.active_from, ["Branch 0"]);
  assert.deepEqual(output.skipped_from, []);
  assert.deepEqual((output.pending_from as string[]).sort(), [
    "Branch 1",
    "Branch 2",
  ]);
  assert.equal(output.emitted_after, 1);
  assert.equal(emitted[0].token.skipped, false);
});

test("join.execute: wait_for_any with all branches skipped emits skipped", async () => {
  const { graph, joinNode } = buildJoinTestGraph("wait_for_any", null, 2);
  const tokens = [
    makeToken("branch-0", "Branch 0", true),
    makeToken("branch-1", "Branch 1", true),
  ];
  const { ctx, completed, emitted } = buildExecuteContext(
    graph,
    joinNode,
    tokens
  );
  await joinOperator.execute!(ctx);

  assert.equal(completed[0].status, "skipped");
  assert.equal(completed[0].output!.reason, "all_skipped");
  assert.equal(emitted[0].token.skipped, true);
});

test("join.execute: quorum reached emits success and reports active branches", async () => {
  const { graph, joinNode } = buildJoinTestGraph("quorum", 2, 3);
  const tokens = [
    makeToken("branch-0", "Branch 0"),
    makeToken("branch-1", "Branch 1"),
  ];
  const { ctx, completed, emitted } = buildExecuteContext(
    graph,
    joinNode,
    tokens
  );
  await joinOperator.execute!(ctx);

  assert.equal(completed[0].status, "success");
  const output = completed[0].output!;
  assert.equal(output.policy, "quorum");
  assert.equal(output.quorum, 2);
  assert.equal(output.reason, "policy_satisfied");
  assert.deepEqual(output.active_from, ["Branch 0", "Branch 1"]);
  assert.deepEqual(output.pending_from, ["Branch 2"]);
  assert.equal(emitted[0].token.skipped, false);
});

test("join.execute: quorum unreachable emits skipped with quorum_unreachable reason", async () => {
  const { graph, joinNode } = buildJoinTestGraph("quorum", 2, 3);
  // 1 active, 2 skipped, all inbound arrived -> can't make quorum=2.
  const tokens = [
    makeToken("branch-0", "Branch 0"),
    makeToken("branch-1", "Branch 1", true),
    makeToken("branch-2", "Branch 2", true),
  ];
  const { ctx, completed, emitted } = buildExecuteContext(
    graph,
    joinNode,
    tokens
  );
  await joinOperator.execute!(ctx);

  assert.equal(completed[0].status, "skipped");
  const output = completed[0].output!;
  assert.equal(output.policy, "quorum");
  assert.equal(output.quorum, 2);
  assert.equal(output.reason, "quorum_unreachable");
  assert.deepEqual(output.active_from, ["Branch 0"]);
  assert.deepEqual((output.skipped_from as string[]).sort(), [
    "Branch 1",
    "Branch 2",
  ]);
  assert.equal(emitted[0].token.skipped, true);
});

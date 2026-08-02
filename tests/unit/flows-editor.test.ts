import assert from "node:assert/strict";
import test from "node:test";
import {
  clearFlowDraftSelection,
  copySelectedFlowDraftItems,
  createFlowDraftSnapshot,
  deleteSelectedFlowDraftItems,
  draftToGraph,
  duplicateSelectedFlowDraftAgents,
  insertFlowDraftAgent,
  insertFlowDraftNodeOnEdge,
  insertFlowDraftNode,
  pasteFlowDraftItems,
  selectFlowDraftEdge,
  selectFlowDraftNode,
  selectAllFlowDraftAgents,
  serializePersistedFlowDraft,
  serializePersistedFlowGraph,
  straightenSelectedFlowDraftNodes,
  tidyFlowDraftLayout,
} from "../../lib/flows/editor";

function makeDraft() {
  return createFlowDraftSnapshot({
    name: "Review Flow",
    description: "Flow description",
    notes: "Flow notes",
    draft_graph: {
      nodes: [
        {
          id: "start",
          type: "start",
          position: { x: 0, y: 0 },
          data: { label: "PR opened", event: "pr_opened" },
        },
        {
          id: "agent-a",
          type: "agent",
          position: { x: 200, y: 0 },
          data: { label: "Reviewer A", agentId: "agent-a" },
        },
        {
          id: "agent-b",
          type: "agent",
          position: { x: 420, y: 0 },
          data: { label: "Reviewer B", agentId: "agent-b" },
        },
        {
          id: "end",
          type: "end",
          position: { x: 640, y: 0 },
          data: { label: "Done" },
        },
      ],
      edges: [
        { id: "edge-start-a", source: "start", target: "agent-a" },
        { id: "edge-a-b", source: "agent-a", target: "agent-b" },
        { id: "edge-b-end", source: "agent-b", target: "end" },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  });
}

test("serializePersistedFlowDraft ignores selection-only changes", () => {
  const draft = makeDraft();
  const selectedDraft = {
    ...draft,
    selectedNodeId: "agent-a",
    nodes: draft.nodes.map((node) => ({
      ...node,
      selected: node.id === "agent-a",
    })),
  };

  assert.equal(
    serializePersistedFlowDraft(draft),
    serializePersistedFlowDraft(selectedDraft)
  );
});

test("serializePersistedFlowDraft ignores viewport-only changes", () => {
  const draft = makeDraft();
  const pannedDraft = {
    ...draft,
    viewport: { x: 120, y: 80, zoom: 0.75 },
  };

  assert.equal(
    serializePersistedFlowDraft(draft),
    serializePersistedFlowDraft(pannedDraft)
  );
});

test("serializePersistedFlowGraph detects saved scope changes without treating viewport as publishable", () => {
  const graph = draftToGraph(makeDraft());
  const changedScope = structuredClone(graph);
  const start = changedScope.nodes.find((node) => node.type === "start");
  assert.ok(start?.type === "start");
  start.data.filter = {
    scope: "all",
    installationIds: [202],
    repos: ["alex/priority-project"],
  };

  assert.notEqual(
    serializePersistedFlowGraph(graph),
    serializePersistedFlowGraph(changedScope)
  );
  assert.equal(
    serializePersistedFlowGraph(graph),
    serializePersistedFlowGraph({
      ...graph,
      viewport: { x: 120, y: 80, zoom: 0.75 },
    })
  );
});

test("deleteSelectedFlowDraftItems removes selected agent nodes and incident edges", () => {
  const draft = {
    ...makeDraft(),
    selectedNodeId: "agent-a",
    nodes: makeDraft().nodes.map((node) => ({
      ...node,
      selected: node.id === "agent-a",
    })),
  };

  const result = deleteSelectedFlowDraftItems(draft);
  assert.equal(result.changed, true);
  assert.deepEqual(
    result.snapshot.nodes.map((node) => node.id),
    ["start", "agent-b", "end"]
  );
  assert.deepEqual(
    result.snapshot.edges.map((edge) => edge.id),
    ["edge-b-end"]
  );
  assert.equal(result.snapshot.selectedNodeId, null);
});

test("duplicateSelectedFlowDraftAgents duplicates selected agent nodes with offset and new selection", () => {
  const draft = {
    ...makeDraft(),
    selectedNodeId: "agent-b",
    nodes: makeDraft().nodes.map((node) => ({
      ...node,
      selected: node.id === "agent-b",
    })),
  };

  let nextId = 0;
  const result = duplicateSelectedFlowDraftAgents(draft, {
    idFactory: () => `copy-${++nextId}`,
  });

  assert.equal(result.changed, true);
  const duplicate = result.snapshot.nodes.find(
    (node) => node.id === "agent-copy-1"
  );
  assert.ok(duplicate);
  assert.equal(duplicate.type, "agent");
  assert.deepEqual(duplicate.position, { x: 468, y: 48 });
  assert.equal(duplicate.selected, true);
  assert.equal(result.snapshot.selectedNodeId, "agent-copy-1");
  assert.equal(result.snapshot.nodes.filter((node) => node.selected).length, 1);
});

test("copySelectedFlowDraftItems captures selected editable nodes and their internal edges", () => {
  const draft = {
    ...makeDraft(),
    selectedNodeId: "agent-a",
    nodes: makeDraft().nodes.map((node) => ({
      ...node,
      selected: node.id === "agent-a" || node.id === "agent-b",
    })),
  };

  const clipboard = copySelectedFlowDraftItems(draft);
  assert.ok(clipboard);
  assert.deepEqual(
    clipboard.nodes.map((node) => node.id),
    ["agent-a", "agent-b"]
  );
  assert.deepEqual(
    clipboard.edges.map((edge) => edge.id),
    ["edge-a-b"]
  );
});

test("pasteFlowDraftItems remaps copied nodes and edges with an offset", () => {
  const draft = {
    ...makeDraft(),
    selectedNodeId: "agent-a",
    nodes: makeDraft().nodes.map((node) => ({
      ...node,
      selected: node.id === "agent-a" || node.id === "agent-b",
    })),
  };
  const clipboard = copySelectedFlowDraftItems(draft);
  assert.ok(clipboard);
  const generatedIds = ["copy-a", "copy-b", "copy-edge"];

  const result = pasteFlowDraftItems(makeDraft(), clipboard, {
    offset: { x: 32, y: 40 },
    idFactory: () => generatedIds.shift()!,
  });

  assert.equal(result.changed, true);
  const firstCopy = result.snapshot.nodes.find(
    (node) => node.id === "agent-copy-a"
  );
  const secondCopy = result.snapshot.nodes.find(
    (node) => node.id === "agent-copy-b"
  );
  assert.deepEqual(firstCopy?.position, { x: 232, y: 40 });
  assert.deepEqual(secondCopy?.position, { x: 452, y: 40 });
  assert.equal(firstCopy?.selected, true);
  assert.equal(secondCopy?.selected, true);
  assert.equal(result.snapshot.selectedNodeId, "agent-copy-a");
  assert.equal(
    result.snapshot.edges.some(
      (edge) => edge.source === "agent-copy-a" && edge.target === "agent-copy-b"
    ),
    true
  );
});

test("selectAllFlowDraftAgents and clearFlowDraftSelection update editable graph selection without touching structure", () => {
  const selected = selectAllFlowDraftAgents(makeDraft());
  assert.equal(selected.nodes.filter((node) => node.selected).length, 2);
  assert.equal(
    selected.nodes.find((node) => node.id === "start")?.selected,
    false
  );
  assert.equal(selected.selectedNodeId, "agent-a");

  const cleared = clearFlowDraftSelection(selected);
  assert.equal(
    cleared.nodes.some((node) => node.selected),
    false
  );
  assert.equal(
    cleared.edges.some((edge) => edge.selected),
    false
  );
  assert.equal(cleared.selectedNodeId, null);
});

test("insertFlowDraftNode creates condition nodes with editable defaults", () => {
  const result = insertFlowDraftNode(makeDraft(), "condition", {
    position: { x: 520, y: 320 },
    idFactory: () => "cond-1",
  });

  assert.equal(result.changed, true);
  const inserted = result.snapshot.nodes.find(
    (node) => node.id === "condition-cond-1"
  );
  assert.ok(inserted);
  assert.equal(inserted.type, "condition");
  assert.deepEqual(inserted.position, { x: 520, y: 320 });
  assert.deepEqual(inserted.data, {
    label: "If 1",
    mode: "all",
    rules: [
      {
        field: "metadata.source_type",
        operator: "equals",
        value: "pr_opened",
      },
    ],
  });
  assert.equal(inserted.selected, true);
});

test("insertFlowDraftNode creates operation-specific action defaults", () => {
  const sandboxResult = insertFlowDraftNode(makeDraft(), "action", {
    operation: "sandbox.run_command",
    idFactory: () => "command",
  });
  const sandboxNode = sandboxResult.snapshot.nodes.find(
    (node) => node.id === "action-command"
  );
  assert.deepEqual(sandboxNode?.data, {
    label: "Run command 1",
    operation: "sandbox.run_command",
    command: "pnpm test",
    workingDirectory: null,
  });

  const slackResult = insertFlowDraftNode(makeDraft(), "action", {
    operation: "slack.send_message",
    idFactory: () => "slack",
  });
  const slackNode = slackResult.snapshot.nodes.find(
    (node) => node.id === "action-slack"
  );
  assert.deepEqual(slackNode?.data, {
    label: "Send Slack message 1",
    operation: "slack.send_message",
    destination: "channel",
    teamId: "",
    channelId: "",
    channelName: null,
    message: "",
    unfurlLinks: false,
  });
});

test("duplicateSelectedFlowDraftAgents duplicates delay nodes without touching structural nodes", () => {
  const draft = createFlowDraftSnapshot({
    name: "Flow",
    description: "",
    notes: "",
    draft_graph: {
      nodes: [
        {
          id: "start",
          type: "start",
          position: { x: 0, y: 0 },
          data: { label: "Start", event: "mention" },
        },
        {
          id: "delay-1",
          type: "delay",
          position: { x: 200, y: 0 },
          data: { label: "Wait", duration: 5, unit: "minutes" },
        },
        {
          id: "end",
          type: "end",
          position: { x: 400, y: 0 },
          data: { label: "Done" },
        },
      ],
      edges: [
        { id: "edge-1", source: "start", target: "delay-1" },
        { id: "edge-2", source: "delay-1", target: "end" },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  });
  const selectedDraft = {
    ...draft,
    selectedNodeId: "delay-1",
    nodes: draft.nodes.map((node) => ({
      ...node,
      selected: node.id === "delay-1",
    })),
  };

  const result = duplicateSelectedFlowDraftAgents(selectedDraft, {
    idFactory: () => "copy-1",
  });

  assert.equal(result.changed, true);
  const duplicate = result.snapshot.nodes.find(
    (node) => node.id === "delay-copy-1"
  );
  assert.ok(duplicate);
  assert.equal(duplicate.type, "delay");
  assert.equal(duplicate.selected, true);
  assert.equal(
    result.snapshot.nodes.find((node) => node.id === "start")?.selected,
    false
  );
});

test("insertFlowDraftAgent appends a selected agent node at the requested position", () => {
  const draft = {
    ...makeDraft(),
    selectedNodeId: "agent-a",
    nodes: makeDraft().nodes.map((node) => ({
      ...node,
      selected: node.id === "agent-a",
    })),
  };

  const result = insertFlowDraftAgent(draft, {
    position: { x: 512, y: 288 },
    label: "Perf reviewer",
    agentId: "agent-c",
    idFactory: () => "new-agent",
  });

  assert.equal(result.changed, true);
  const inserted = result.snapshot.nodes.find(
    (node) => node.id === "agent-new-agent"
  );
  assert.ok(inserted);
  assert.deepEqual(inserted.position, { x: 512, y: 288 });
  assert.deepEqual(inserted.data, {
    label: "Perf reviewer",
    agentId: "agent-c",
    harness: "mogplex",
    role: "review",
    autofix: false,
    autofixSandbox: false,
    autoMerge: false,
    autoRevert: false,
    requireApproval: false,
    modelOverride: null,
    maxStepsOverride: null,
    timeoutMsOverride: null,
    systemPromptOverride: null,
  });
  assert.equal(inserted.selected, true);
  assert.equal(result.snapshot.nodes.filter((node) => node.selected).length, 1);
  assert.equal(result.snapshot.selectedNodeId, "agent-new-agent");
});

test("insertFlowDraftNodeOnEdge rewires the path through a new agent node", () => {
  const draft = makeDraft();
  let nextId = 0;

  const result = insertFlowDraftNodeOnEdge(draft, "edge-a-b", "agent", {
    idFactory: () => `insert-${++nextId}`,
    label: "Editor",
    agentId: "agent-c",
    role: "edit",
  });

  assert.equal(result.changed, true);
  assert.equal(
    result.snapshot.nodes.some((node) => node.id === "agent-insert-1"),
    true
  );
  assert.equal(
    result.snapshot.edges.some((edge) => edge.id === "edge-a-b"),
    false
  );
  assert.equal(
    result.snapshot.edges.some(
      (edge) => edge.source === "agent-a" && edge.target === "agent-insert-1"
    ),
    true
  );
  assert.equal(
    result.snapshot.edges.some(
      (edge) => edge.source === "agent-insert-1" && edge.target === "agent-b"
    ),
    true
  );
});

test("straightenSelectedFlowDraftNodes aligns selected editable nodes on one horizontal track", () => {
  const draft = {
    ...makeDraft(),
    nodes: makeDraft().nodes.map((node) => ({
      ...node,
      selected: node.id === "agent-a" || node.id === "agent-b",
      position:
        node.id === "agent-a"
          ? { x: 200, y: 40 }
          : node.id === "agent-b"
            ? { x: 420, y: 220 }
            : node.position,
    })),
  };

  const result = straightenSelectedFlowDraftNodes(draft);
  assert.equal(result.changed, true);
  assert.equal(
    result.snapshot.nodes.find((node) => node.id === "agent-a")?.position.y,
    130
  );
  assert.equal(
    result.snapshot.nodes.find((node) => node.id === "agent-b")?.position.y,
    130
  );
});

test("tidyFlowDraftLayout spaces nodes by graph depth", () => {
  const result = tidyFlowDraftLayout(makeDraft());
  assert.equal(result.changed, true);
  assert.equal(
    result.snapshot.nodes.find((node) => node.id === "start")?.position.x,
    180
  );
  assert.equal(
    result.snapshot.nodes.find((node) => node.id === "agent-a")?.position.x,
    460
  );
  assert.equal(
    result.snapshot.nodes.find((node) => node.id === "agent-b")?.position.x,
    740
  );
  assert.equal(
    result.snapshot.nodes.find((node) => node.id === "end")?.position.x,
    1020
  );
});

test("selectFlowDraftNode selects only the target node and clears edge selection", () => {
  const draft = {
    ...makeDraft(),
    edges: makeDraft().edges.map((edge) => ({
      ...edge,
      selected: edge.id === "edge-a-b",
    })),
  };

  const selected = selectFlowDraftNode(draft, "agent-b");
  assert.equal(selected.selectedNodeId, "agent-b");
  assert.equal(
    selected.nodes.find((node) => node.id === "agent-b")?.selected,
    true
  );
  assert.equal(selected.nodes.filter((node) => node.selected).length, 1);
  assert.equal(
    selected.edges.some((edge) => edge.selected),
    false
  );
});

test("selectFlowDraftEdge selects only the target edge and clears node selection", () => {
  const draft = {
    ...makeDraft(),
    selectedNodeId: "agent-a",
    nodes: makeDraft().nodes.map((node) => ({
      ...node,
      selected: node.id === "agent-a",
    })),
  };

  const selected = selectFlowDraftEdge(draft, "edge-a-b");
  assert.equal(selected.selectedNodeId, null);
  assert.equal(
    selected.nodes.some((node) => node.selected),
    false
  );
  assert.equal(
    selected.edges.find((edge) => edge.id === "edge-a-b")?.selected,
    true
  );
  assert.equal(selected.edges.filter((edge) => edge.selected).length, 1);
});

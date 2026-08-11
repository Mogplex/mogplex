import assert from "node:assert/strict";
import test from "node:test";
import {
  createFlowDraftSnapshot,
  duplicateSelectedFlowDraftAgents,
  insertFlowDraftAgent,
  insertFlowDraftNode,
  insertFlowDraftNodeOnEdge,
} from "../../lib/flows/editor";
import { makeDraft } from "./helpers/flows-editor-fixtures";

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
    fallbackModelOverride: null,
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

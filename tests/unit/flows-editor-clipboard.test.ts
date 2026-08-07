import assert from "node:assert/strict";
import test from "node:test";
import {
  clearFlowDraftSelection,
  copySelectedFlowDraftItems,
  deleteSelectedFlowDraftItems,
  duplicateSelectedFlowDraftAgents,
  pasteFlowDraftItems,
  selectAllFlowDraftAgents,
} from "../../lib/flows/editor";
import { makeDraft } from "./helpers/flows-editor-fixtures";

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

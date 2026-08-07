import assert from "node:assert/strict";
import test from "node:test";
import {
  selectFlowDraftEdge,
  selectFlowDraftNode,
  straightenSelectedFlowDraftNodes,
  tidyFlowDraftLayout,
} from "../../lib/flows/editor";
import { makeDraft } from "./helpers/flows-editor-fixtures";

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

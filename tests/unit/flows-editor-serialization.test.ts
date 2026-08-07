import assert from "node:assert/strict";
import test from "node:test";
import {
  draftToGraph,
  serializePersistedFlowDraft,
  serializePersistedFlowGraph,
} from "../../lib/flows/editor";
import { makeDraft } from "./helpers/flows-editor-fixtures";

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

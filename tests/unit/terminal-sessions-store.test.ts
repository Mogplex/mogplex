import assert from "node:assert/strict";
import test from "node:test";
import { useTerminalSessionsStore } from "../../hooks/use-terminal-sessions";

function resetTerminalSessionsStore() {
  useTerminalSessionsStore.setState({
    anchors: {},
    bindings: {},
  });
}

function createAnchor() {
  return { isConnected: true } as HTMLElement;
}

test("clearAnchorIfCurrent does not wipe a replacement anchor from a remounted pane", () => {
  resetTerminalSessionsStore();
  const paneId = "pane-1";
  const firstAnchor = createAnchor();
  const replacementAnchor = createAnchor();

  useTerminalSessionsStore.getState().setAnchor(paneId, firstAnchor);
  useTerminalSessionsStore.getState().setAnchor(paneId, replacementAnchor);
  useTerminalSessionsStore.getState().clearAnchorIfCurrent(paneId, firstAnchor);

  assert.equal(
    useTerminalSessionsStore.getState().anchors[paneId],
    replacementAnchor
  );
});

test("clearAnchorIfCurrent removes the active anchor during a real unmount", () => {
  resetTerminalSessionsStore();
  const paneId = "pane-2";
  const anchor = createAnchor();

  useTerminalSessionsStore.getState().setAnchor(paneId, anchor);
  useTerminalSessionsStore.getState().clearAnchorIfCurrent(paneId, anchor);

  assert.equal(useTerminalSessionsStore.getState().anchors[paneId], null);
});

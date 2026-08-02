import assert from "node:assert/strict";
import test from "node:test";
import { resolveTerminalPortalTarget } from "../../lib/terminal-portal-target";

function createAnchor(isConnected: boolean) {
  return { isConnected } as HTMLElement;
}

test("resolveTerminalPortalTarget prefers the connected live anchor", () => {
  const anchor = createAnchor(true);
  const lastAnchor = createAnchor(true);
  const fallback = createAnchor(true);

  const target = resolveTerminalPortalTarget({
    anchor,
    lastAnchor,
    fallback,
  });

  assert.equal(target, anchor);
});

test("resolveTerminalPortalTarget keeps the last connected anchor during handoff", () => {
  const lastAnchor = createAnchor(true);
  const fallback = createAnchor(true);

  const target = resolveTerminalPortalTarget({
    anchor: null,
    lastAnchor,
    fallback,
  });

  assert.equal(target, lastAnchor);
});

test("resolveTerminalPortalTarget ignores disconnected anchors and falls back", () => {
  const target = resolveTerminalPortalTarget({
    anchor: createAnchor(false),
    lastAnchor: createAnchor(false),
    fallback: createAnchor(true),
  });

  assert.equal(target?.isConnected, true);
});

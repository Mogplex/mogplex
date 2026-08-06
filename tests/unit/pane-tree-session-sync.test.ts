import assert from "node:assert/strict";
import test from "node:test";
import {
  createPaneTreeSessionSync,
  matchesPaneTreeSession,
  type PendingPaneTreeSync,
} from "../../lib/pane-tree-session-sync";

type Tree = { name: string };

function createTimerHarness() {
  const callbacks = new Map<number, () => void>();
  const cleared = new Set<number>();
  let nextTimer = 1;

  return {
    callbacks,
    cleared,
    scheduleTimer(callback: () => void) {
      const timer = nextTimer++;
      callbacks.set(timer, callback);
      return timer;
    },
    clearTimer(timer: unknown) {
      cleared.add(timer as number);
    },
  };
}

function buildSync(sessionId: string, name: string): PendingPaneTreeSync<Tree> {
  return {
    sessionId,
    root: { name },
    activeId: `active-${name}`,
  };
}

test("pane tree sync ignores a stale timer and commits the latest session snapshot", () => {
  const timers = createTimerHarness();
  const updates: PendingPaneTreeSync<Tree>[] = [];
  const controller = createPaneTreeSessionSync<Tree>({
    updatePaneTree: (root, activeId, { sessionId }) => {
      updates.push({ root, activeId, sessionId });
    },
    scheduleTimer: timers.scheduleTimer,
    clearTimer: timers.clearTimer,
  });
  const first = buildSync("session-1", "first");
  const second = buildSync("session-2", "second");

  controller.schedule(first);
  controller.schedule(second);
  timers.callbacks.get(1)?.();
  timers.callbacks.get(2)?.();

  assert.deepEqual(updates, [second]);
  assert.deepEqual([...timers.cleared], [1]);
});

test("pane tree sync flushes a cancelled debounce exactly once", () => {
  const timers = createTimerHarness();
  const updates: PendingPaneTreeSync<Tree>[] = [];
  const controller = createPaneTreeSessionSync<Tree>({
    updatePaneTree: (root, activeId, { sessionId }) => {
      updates.push({ root, activeId, sessionId });
    },
    scheduleTimer: timers.scheduleTimer,
    clearTimer: timers.clearTimer,
  });
  const pending = buildSync("originating-session", "pending");

  controller.schedule(pending);
  controller.cancelTimer();
  assert.equal(controller.flush(), true);
  timers.callbacks.get(1)?.();

  assert.deepEqual(updates, [pending]);
  assert.equal(controller.flush(), false);
});

test("pane tree sync discards a cancelled snapshot without a later flush", () => {
  const timers = createTimerHarness();
  const updates: PendingPaneTreeSync<Tree>[] = [];
  const controller = createPaneTreeSessionSync<Tree>({
    updatePaneTree: (root, activeId, { sessionId }) => {
      updates.push({ root, activeId, sessionId });
    },
    scheduleTimer: timers.scheduleTimer,
    clearTimer: timers.clearTimer,
  });

  controller.schedule(buildSync("session-1", "obsolete"));
  controller.discard();
  timers.callbacks.get(1)?.();

  assert.equal(controller.flush(), false);
  assert.deepEqual(updates, []);
});

test("pane tree sync recognizes a tree already loaded from its session", () => {
  const pending = buildSync("session-1", "loaded");

  assert.equal(
    matchesPaneTreeSession(pending, {
      id: pending.sessionId,
      paneTree: pending.root,
      activeId: pending.activeId,
    }),
    true
  );
  assert.equal(
    matchesPaneTreeSession(pending, {
      id: pending.sessionId,
      paneTree: { ...pending.root },
      activeId: pending.activeId,
    }),
    false
  );
});

export type PendingPaneTreeSync<TTree> = {
  sessionId: string;
  root: TTree;
  activeId: string;
};

type PaneTreeSession<TTree> = {
  id: string;
  paneTree: TTree;
  activeId: string;
};

type UpdatePaneTree<TTree> = (
  tree: TTree,
  activeId: string,
  options: { sessionId: string }
) => void;

type PaneTreeSyncOptions<TTree> = {
  updatePaneTree: UpdatePaneTree<TTree>;
  delayMs?: number;
  scheduleTimer?: (callback: () => void, delayMs: number) => unknown;
  clearTimer?: (timer: unknown) => void;
};

export function matchesPaneTreeSession<TTree>(
  pending: PendingPaneTreeSync<TTree>,
  session: PaneTreeSession<TTree> | null | undefined
) {
  return Boolean(
    session?.id === pending.sessionId &&
    session.paneTree === pending.root &&
    session.activeId === pending.activeId
  );
}

export function createPaneTreeSessionSync<TTree>({
  updatePaneTree,
  delayMs = 100,
  scheduleTimer = (callback, delay) => setTimeout(callback, delay),
  clearTimer = (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
}: PaneTreeSyncOptions<TTree>) {
  let pending: PendingPaneTreeSync<TTree> | null = null;
  let timer: unknown = null;

  const cancelTimer = () => {
    if (timer === null) return;
    clearTimer(timer);
    timer = null;
  };

  const commit = (sync: PendingPaneTreeSync<TTree>) => {
    updatePaneTree(sync.root, sync.activeId, { sessionId: sync.sessionId });
  };

  return {
    schedule(sync: PendingPaneTreeSync<TTree>) {
      cancelTimer();
      pending = sync;
      const scheduledSync = sync;
      timer = scheduleTimer(() => {
        if (pending !== scheduledSync) return;
        pending = null;
        timer = null;
        commit(scheduledSync);
      }, delayMs);
    },
    cancelTimer,
    discard() {
      cancelTimer();
      pending = null;
    },
    flush() {
      cancelTimer();
      if (!pending) return false;
      const sync = pending;
      pending = null;
      commit(sync);
      return true;
    },
  };
}

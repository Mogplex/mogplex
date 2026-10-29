export type TerminalScrollMetrics = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  rowHeight: number;
};

/** Track whether the reader is following output across terminal reflows. */
export function createTerminalScrollFollow(initial: TerminalScrollMetrics) {
  const isAtBottom = (metrics: TerminalScrollMetrics) =>
    metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight <
    Math.max(5, metrics.rowHeight);
  let following = isAtBottom(initial);
  return {
    get following() {
      return following;
    },
    onScroll(metrics: TerminalScrollMetrics, resizePending = false) {
      // Rebuilding wterm's rows briefly collapses the scroll area. Its native
      // scroll events describe reflow, not a change in the reader's intent.
      if (!resizePending) following = isAtBottom(metrics);
    },
  };
}

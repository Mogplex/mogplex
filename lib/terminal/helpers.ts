import type { TerminalExecFallbackReason } from "@/hooks/use-terminal-transport";

/**
 * Creates a hidden fallback DOM container for terminal portal mounting.
 * Sessions rendered by TerminalHost survive pane remounts, but when no pane
 * currently mounts a terminal we still need a valid DOM target for createPortal
 * to avoid React warnings. The fallback retains the pane's last dimensions so
 * wterm's auto-resize does not collapse its grid and destroy the visible buffer.
 */
export function createFallbackContainer(paneId: string): HTMLDivElement {
  const fallback = document.createElement("div");
  fallback.setAttribute("data-terminal-session-fallback", paneId);
  fallback.style.cssText =
    "position:fixed;left:-100000px;top:0;width:1px;height:1px;overflow:hidden;pointer-events:none;visibility:hidden;";
  return fallback;
}

/**
 * Produces a human-readable message describing why the terminal fell back
 * from PTY mode to exec mode.
 */
export function describeExecFallback(
  reason: TerminalExecFallbackReason | undefined,
  detail: string | undefined
): string | null {
  const normalizedDetail =
    typeof detail === "string" && detail.trim().length > 0
      ? detail.trim()
      : undefined;

  switch (reason) {
    case "pty_disabled":
      return "PTY disabled; using exec fallback.";
    case "bridge_not_ready":
      return "PTY not ready yet; using exec fallback.";
    case "tmux_unavailable":
      return normalizedDetail
        ? `PTY unavailable: ${normalizedDetail}.`
        : "PTY unavailable because tmux could not be prepared.";
    case "bridge_install_failed":
      return normalizedDetail
        ? `PTY unavailable: ${normalizedDetail}.`
        : "PTY unavailable because the terminal bridge failed to install.";
    case "bridge_unreachable":
      return normalizedDetail
        ? `PTY unavailable: ${normalizedDetail}.`
        : "PTY unavailable because the terminal bridge could not be reached.";
    case "http_error":
      return normalizedDetail
        ? `PTY setup failed: ${normalizedDetail}.`
        : "PTY setup failed; using exec fallback.";
    case "connect_failed":
      return normalizedDetail
        ? `PTY setup failed: ${normalizedDetail}.`
        : "PTY setup failed; using exec fallback.";
    default:
      return normalizedDetail ?? null;
  }
}

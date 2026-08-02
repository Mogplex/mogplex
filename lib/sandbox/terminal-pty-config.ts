// Phase 2b scaffolding. The PTY bridge is off by default — Phase 2a's
// streaming exec path is the default transport. Flipping this flag (server-
// side env) enables port exposure and the /terminal/connect endpoint; the
// client then upgrades from exec-SSE to WebSocket-PTY automatically.

export const TERMINAL_PTY_PORT = 4020;
export const TERMINAL_PTY_FEATURE_FLAG = "MOGPLEX_TERMINAL_PTY";

// When adding runtime-side reasons for the bridge not being available, extend
// this union so the client transport hook can surface them consistently.
export type TerminalPtyUnavailableReason =
  | "pty_disabled"
  | "bridge_not_ready"
  | "bridge_unreachable"
  | "tmux_unavailable"
  | "bridge_install_failed";

export type TerminalPtyConnectInfo =
  | {
      available: false;
      reason: TerminalPtyUnavailableReason;
      detail?: string;
    }
  | {
      available: true;
      terminalSessionKey: string;
      wsUrl: string;
      token: string;
      expiresAt: number;
      /**
       * False when the sandbox came up without tmux — the PTY still works,
       * but reconnects spawn a fresh shell and previous scrollback is lost.
       * Clients should use this to surface a one-time "no session persistence"
       * warning in the terminal UI.
       */
      tmuxAvailable?: boolean;
    };

export function isTerminalPtyEnabled(): boolean {
  const value = process.env[TERMINAL_PTY_FEATURE_FLAG];
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "1" || normalized === "true" || normalized === "enabled"
  );
}

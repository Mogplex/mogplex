import type { CSSProperties } from "react";

/* eslint-disable unicorn/escape-case, unicorn/no-hex-escape */
// ANSI escape code constants for terminal output formatting
export const ANSI = {
  // Control sequences
  ESC: "\x1b",
  RESET: "\x1b[0m",
  CLEAR_SCREEN: "\x1b[1;1H\x1b[2J\x1b[3J\x1b[1;1H",

  // Colors
  RED: "\x1b[31m",
  YELLOW: "\x1b[33m",
  WHITE: "\x1b[37m",
  GRAY: "\x1b[90m",

  // Input key sequences
  ARROW_UP: "\x1b[A",
  ARROW_DOWN: "\x1b[B",
  BACKSPACE: "\x7f",
  CTRL_C: "\x03",
} as const;
/* eslint-enable unicorn/escape-case, unicorn/no-hex-escape */

export const MOGPLEX_WTERM_STYLE = {
  height: "100%",
  width: "100%",
  borderRadius: 0,
  boxShadow: "none",
  padding: "12px",
  // wterm scrolls scrollback via native overflow on the .wterm element (it has
  // no internal wheel handler). scrollbar-gutter:stable reserves the 4px gutter
  // so autoResize's column count doesn't jitter when .has-scrollback toggles.
  scrollbarGutter: "stable",
  "--term-bg": "var(--terminal-background)",
  "--term-fg": "var(--terminal-foreground)",
  "--term-cursor": "var(--terminal-cursor)",
  "--term-font-family":
    "Geist Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  "--term-font-size": "13px",
  "--term-color-0": "var(--terminal-background)",
  "--term-color-1": "var(--accent-red)",
  "--term-color-2": "var(--accent-green)",
  "--term-color-3": "var(--accent-amber)",
  "--term-color-4": "var(--accent-blue)",
  "--term-color-5": "var(--accent-violet)",
  "--term-color-6": "var(--accent-cyan)",
  "--term-color-7": "var(--terminal-foreground)",
  "--term-color-8": "var(--terminal-muted)",
  "--term-color-9": "var(--accent-red)",
  "--term-color-10": "var(--accent-green)",
  "--term-color-11": "var(--accent-amber)",
  "--term-color-12": "var(--accent-blue)",
  "--term-color-13": "var(--accent-violet)",
  "--term-color-14": "var(--accent-cyan)",
  "--term-color-15": "var(--terminal-cursor)",
} as CSSProperties;

export const MAX_HISTORY = 200;

// Shared command history across all terminal sessions in this browser tab.
export const commandHistory: string[] = [];

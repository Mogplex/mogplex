// Sandbox exec runs `sh -lc '<command>'` via @vercel/sandbox which exposes no
// stdin API — so any program that requires a TTY fails in confusing ways
// (Claude Code errors with "Input must be provided ... --print", REPLs hang,
// vim draws garbage). Detect the common offenders up front and return a
// targeted hint instead.

export type InteractiveInvocationHit = {
  kind: "harness-bare" | "tui" | "repl-bare" | "db-repl";
  binary: string;
  message: string;
};

const TUI_BINARIES = new Set([
  "vim",
  "nvim",
  "vi",
  "nano",
  "pico",
  "emacs",
  "joe",
  "micro",
  "htop",
  "top",
  "btop",
  "atop",
  "less",
  "more",
  "most",
  "watch",
  "tig",
  "man",
  "ssh",
  "sftp",
  "mc",
  "ncdu",
]);

const REPL_BINARIES = new Set([
  "python",
  "python3",
  "node",
  "deno",
  "bun",
  "irb",
  "ruby",
  "ghci",
  "lua",
  "php",
  "scala",
  "tclsh",
  "perl",
]);

const DB_REPL_BINARIES = new Set([
  "psql",
  "mysql",
  "mongo",
  "mongosh",
  "redis-cli",
  "sqlite3",
  "cqlsh",
]);

const DB_REPL_NON_INTERACTIVE_FLAGS = new Set([
  "-c",
  "-e",
  "--command",
  "--eval",
  "-f",
  "--file",
]);

function firstTokenAfterEnv(command: string): string[] {
  const tokens = command.trim().split(/\s+/);
  // Skip leading env-style assignments (FOO=bar BAR=baz cmd ...) so we
  // identify the real binary being invoked.
  let i = 0;
  while (i < tokens.length && /^[A-Za-z_]\w*=/.test(tokens[i])) i++;
  return tokens.slice(i);
}

export function detectInteractiveInvocation(
  command: string
): InteractiveInvocationHit | null {
  const tokens = firstTokenAfterEnv(command);
  if (tokens.length === 0) return null;

  const bin = tokens[0];
  const args = tokens.slice(1);

  if (bin === "claude" && args.length === 0) {
    return {
      kind: "harness-bare",
      binary: bin,
      message:
        "Claude Code's interactive REPL needs a real TTY, which the sandbox terminal can't provide yet.\n" +
        'Try: claude -p "your prompt"\n' +
        "Or run it from the Agent pane, which streams through the harness.",
    };
  }

  if (bin === "codex" && args.length === 0) {
    return {
      kind: "harness-bare",
      binary: bin,
      message:
        "Codex's interactive mode needs a TTY that the sandbox terminal can't provide yet.\n" +
        "Use the Agent pane with the Codex model, or pass a prompt argument.",
    };
  }

  if (TUI_BINARIES.has(bin)) {
    const hint =
      bin === "vim" ||
      bin === "nvim" ||
      bin === "vi" ||
      bin === "nano" ||
      bin === "emacs"
        ? "Open the file in the Editor pane instead."
        : bin === "ssh" || bin === "sftp"
          ? "Non-interactive usage only, e.g. `ssh host -- command`."
          : "This TUI needs a PTY; run it locally or wait for PTY support.";
    return {
      kind: "tui",
      binary: bin,
      message: `\`${bin}\` needs an interactive terminal (PTY) which the sandbox can't provide yet.\n${hint}`,
    };
  }

  if (REPL_BINARIES.has(bin) && args.length === 0) {
    return {
      kind: "repl-bare",
      binary: bin,
      message:
        `\`${bin}\` started with no arguments drops into a REPL and hangs without a TTY.\n` +
        `Try: ${bin} -c "..."  or pass a script file.`,
    };
  }

  if (DB_REPL_BINARIES.has(bin)) {
    const hasNonInteractiveFlag = args.some(
      (a) =>
        DB_REPL_NON_INTERACTIVE_FLAGS.has(a) ||
        a.startsWith("-c=") ||
        a.startsWith("--command=") ||
        a.startsWith("--eval=")
    );
    if (!hasNonInteractiveFlag) {
      return {
        kind: "db-repl",
        binary: bin,
        message:
          `\`${bin}\` opens an interactive prompt and needs a PTY.\n` +
          `Pass a one-shot command with \`-c\` / \`-e\` / \`--eval\` instead.`,
      };
    }
  }

  return null;
}

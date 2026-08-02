export type HarnessExecutionMode = "AUTO" | "YOLO" | "SAFE";

const CLAUDE_SHARED_DISALLOWED_TOOLS = [
  "Task",
  "WebFetch",
  "WebSearch",
  "NotebookEdit",
  "Read(./.env)",
  "Read(./.env.*)",
  "Read(./**/.env)",
  "Read(./**/.env.*)",
  "Read(./secrets/**)",
  "Read(./supabase/.temp/**)",
  "Bash(curl *)",
  "Bash(wget *)",
  "Bash(nc *)",
  "Bash(netcat *)",
  "Bash(ssh *)",
  "Bash(scp *)",
  "Bash(rsync *)",
  "Bash(ftp *)",
  "Bash(telnet *)",
  // git push is permitted so harness agents can open PRs using the
  // installation token wired into git's credential helper. Destructive
  // variants remain blocked: force-push rewrites history on the remote,
  // --mirror/--delete can wipe branches, `:` refspecs can delete, and
  // `+refspec` prefixes are equivalent to --force for a specific ref.
  // Note: this is a pattern-based deny list — glob matching (e.g.
  // `git push -uf` where -f is bundled) may not catch every variant.
  // The real backstop is the installation token's scopes; treat this
  // list as defense in depth, not a security boundary.
  "Bash(git push --force *)",
  "Bash(git push --force)",
  "Bash(git push --force-with-lease *)",
  "Bash(git push --force-with-lease)",
  "Bash(git push --force-with-lease=*)",
  "Bash(git push --force-if-includes *)",
  "Bash(git push -f *)",
  "Bash(git push -f)",
  "Bash(git push --mirror *)",
  "Bash(git push --delete *)",
  "Bash(git push -d *)",
  "Bash(git push * :*)",
  "Bash(git push * +*)",
  "Bash(git reset --hard *)",
  "Bash(git clean *)",
  "Bash(rm -rf *)",
  "Bash(shred *)",
  "Bash(dd *)",
  "Bash(sudo *)",
];

const CLAUDE_AUTO_ALLOWED_TOOLS = [
  "Bash",
  "Edit",
  "Glob",
  "Grep",
  "LS",
  "MultiEdit",
  "Read",
  "TodoWrite",
  "Write",
];

function withDisallowedTools(args: string[]) {
  return [
    ...args,
    "--disallowedTools",
    CLAUDE_SHARED_DISALLOWED_TOOLS.join(","),
  ];
}

export function normalizeHarnessExecutionMode(
  value?: string | null
): HarnessExecutionMode {
  const normalized = value?.trim().toUpperCase();
  if (normalized === "SAFE" || normalized === "YOLO") return normalized;
  return "AUTO";
}

export function buildClaudePermissionArgs(mode?: string | null) {
  const normalizedMode = normalizeHarnessExecutionMode(mode);

  if (normalizedMode === "SAFE") {
    return withDisallowedTools(["--permission-mode", "plan"]);
  }

  if (normalizedMode === "YOLO") {
    return withDisallowedTools(["--dangerously-skip-permissions"]);
  }

  return withDisallowedTools([
    "--permission-mode",
    "acceptEdits",
    "--allowedTools",
    CLAUDE_AUTO_ALLOWED_TOOLS.join(","),
  ]);
}

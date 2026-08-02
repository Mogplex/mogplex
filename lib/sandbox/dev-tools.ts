import type { Sandbox } from "@vercel/sandbox";

// Pinned for reproducibility + supply-chain hygiene. Bump intentionally
// when a newer version is needed. Tarball is served by GitHub's own
// releases CDN, fetched once per sandbox and reused via an idempotency
// check on `gh --version`.
const GH_CLI_VERSION = "2.65.0";
const GH_CLI_ARCH = "linux_amd64"; // Vercel Sandbox is Linux x86_64

const DEFAULT_AGENT_NAME = "mogplex-agent[bot]";
const DEFAULT_AGENT_EMAIL = "mogplex-agent[bot]@users.noreply.github.com";
const LEGACY_AGENT_EMAIL = "bot@mogplex.dev";
const MOGPLEX_STATE_DIR = "$HOME/.mogplex";
const MOGPLEX_BIN_DIR = `${MOGPLEX_STATE_DIR}/bin`;
const MOGPLEX_GITHUB_TOKEN_FILE = `${MOGPLEX_STATE_DIR}/github-token`;
const MOGPLEX_GH_CONFIG_DIR = `${MOGPLEX_STATE_DIR}/gh`;
const MOGPLEX_GH_REAL_BIN = `${MOGPLEX_BIN_DIR}/gh-real`;
const MOGPLEX_GITHUB_HOOK_START = "# >>> mogplex github auth >>>";
const MOGPLEX_GITHUB_HOOK_END = "# <<< mogplex github auth <<<";

export type EnsureDevToolsOptions = {
  agentName?: string;
  agentEmail?: string;
  ensureTmux?: boolean;
  requireTmux?: boolean;
};

export const TMUX_AVAILABILITY_SENTINEL = "MOGPLEX_TMUX_AVAILABLE";

/**
 * Ensure a harness sandbox has the tooling agents need to do GitHub work
 * on the user's behalf:
 *
 *  1. `gh` CLI on PATH (idempotent — downloads + installs only when missing).
 *  2. A git credential helper plus a managed `gh` config directory that read
 *     the current token from `$HOME/.mogplex/github-token`, so token refreshes
 *     do not require a new shell process.
 *  3. A git identity so `git commit` works immediately. We preserve
 *     user-customized identities, but refresh missing or Mogplex-managed
 *     bot identities so Vercel can match pushed commits to a GitHub user.
 *
 * Runs as a single shell invocation so the round-trip to the sandbox is
 * one RPC. Non-fatal: any failure is logged and skipped — the harness
 * still launches, just without gh/git niceties.
 */
export async function ensureDevTools(
  sandbox: Sandbox,
  options: EnsureDevToolsOptions = {}
): Promise<{
  ok: boolean;
  logs: string;
  error?: string;
  tmuxAvailable?: boolean;
}> {
  const agentName = options.agentName ?? DEFAULT_AGENT_NAME;
  const agentEmail = options.agentEmail ?? DEFAULT_AGENT_EMAIL;

  const script = buildEnsureDevToolsScript({
    ghVersion: GH_CLI_VERSION,
    ghArch: GH_CLI_ARCH,
    agentName,
    agentEmail,
    ensureTmux: options.ensureTmux ?? false,
    requireTmux: options.requireTmux ?? false,
  });

  try {
    const command = await sandbox.runCommand({
      cmd: "sh",
      args: ["-lc", script],
    });
    const logs = await collectCommandLogs(command);
    const result = await command.wait();
    const tmuxAvailable = parseTmuxAvailability(logs);
    if (result.exitCode !== 0) {
      return {
        ok: false,
        logs,
        error: `ensureDevTools exited with code ${result.exitCode}`,
        tmuxAvailable,
      };
    }
    return { ok: true, logs, tmuxAvailable };
  } catch (err) {
    return {
      ok: false,
      logs: "",
      error: err instanceof Error ? err.message : "ensureDevTools failed",
    };
  }
}

/**
 * Ensure terminal tooling is set up. Tmux install is best-effort: session
 * persistence is nice-to-have, but the bridge runtime falls back to a plain
 * shell when tmux isn't on PATH, so we never hard-fail the PTY on a failed
 * `dnf install`. Callers read `tmuxAvailable` to decide whether to surface
 * a "no persistence" warning to the user.
 */
export async function ensureTerminalTools(
  sandbox: Sandbox,
  options: Omit<EnsureDevToolsOptions, "ensureTmux" | "requireTmux"> = {}
) {
  return ensureDevTools(sandbox, {
    ...options,
    ensureTmux: true,
    requireTmux: false,
  });
}

export function parseTmuxAvailability(logs: string): boolean | undefined {
  const match = logs.match(
    new RegExp(`${TMUX_AVAILABILITY_SENTINEL}=([01])(?!\\S)`, "g")
  );
  if (!match || match.length === 0) return undefined;
  // Use the last sentinel so a repeated script run reports its final state.
  const last = match[match.length - 1];
  return last.endsWith("=1");
}

export async function syncTerminalRuntimeAuth(
  sandbox: Sandbox,
  options: {
    githubToken?: string | null;
  }
): Promise<{ ok: boolean; logs: string; error?: string }> {
  const script = buildSyncTerminalRuntimeAuthScript({
    githubToken: options.githubToken ?? null,
  });

  try {
    const command = await sandbox.runCommand({
      cmd: "sh",
      args: ["-lc", script],
    });
    const logs = await collectCommandLogs(command);
    const result = await command.wait();
    if (result.exitCode !== 0) {
      return {
        ok: false,
        logs,
        error: `syncTerminalRuntimeAuth exited with code ${result.exitCode}`,
      };
    }
    return { ok: true, logs };
  } catch (err) {
    return {
      ok: false,
      logs: "",
      error:
        err instanceof Error ? err.message : "syncTerminalRuntimeAuth failed",
    };
  }
}

type BuildScriptArgs = {
  ghVersion: string;
  ghArch: string;
  agentName: string;
  agentEmail: string;
  ensureTmux?: boolean;
  requireTmux?: boolean;
};

export function buildEnsureDevToolsScript({
  ghVersion,
  ghArch,
  agentName,
  agentEmail,
  ensureTmux = false,
  requireTmux = false,
}: BuildScriptArgs): string {
  // All identity strings are inserted via single-quoted shell literals with
  // any embedded single quotes escaped. ghVersion/ghArch are pinned
  // constants controlled by this file, not user input, so interpolation is
  // safe; escape anyway for defense in depth.
  const q = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;
  const dq = (value: string) =>
    `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
  const githubHook = `cat <<'EOF' >> "$HOME/.bashrc"
${MOGPLEX_GITHUB_HOOK_START}
_mogplex_refresh_github_auth() {
  local token_file="${MOGPLEX_GITHUB_TOKEN_FILE}"
  export GH_CONFIG_DIR="${MOGPLEX_GH_CONFIG_DIR}"
  export MOGPLEX_GITHUB_TOKEN_FILE="$token_file"
  if [ -r "$token_file" ]; then
    local token
    token="$(cat "$token_file" 2>/dev/null || true)"
    if [ -n "$token" ]; then
      export GITHUB_TOKEN="$token"
      export GH_TOKEN="$token"
      return
    fi
  fi
  unset GITHUB_TOKEN
  unset GH_TOKEN
}
case ";$PROMPT_COMMAND;" in
  *";_mogplex_refresh_github_auth;"*) ;;
  *) PROMPT_COMMAND="_mogplex_refresh_github_auth\${PROMPT_COMMAND:+;$PROMPT_COMMAND}" ;;
esac
_mogplex_refresh_github_auth
${MOGPLEX_GITHUB_HOOK_END}
EOF`;
  const ghWrapper = `cat <<'EOF' > "$HOME/.local/bin/gh"
#!/bin/sh
set -eu
export GH_CONFIG_DIR="${MOGPLEX_GH_CONFIG_DIR}"
unset GH_TOKEN
unset GITHUB_TOKEN
if [ -x "${MOGPLEX_GH_REAL_BIN}" ]; then
  exec "${MOGPLEX_GH_REAL_BIN}" "$@"
fi
for gh_candidate in /usr/local/bin/gh /usr/bin/gh /bin/gh; do
  if [ -x "$gh_candidate" ]; then
    exec "$gh_candidate" "$@"
  fi
done
echo "gh is not installed" >&2
exit 127
EOF
chmod +x "$HOME/.local/bin/gh"`;

  return `
set -u
mkdir -p "$HOME/.local/bin"
mkdir -p ${MOGPLEX_BIN_DIR}
mkdir -p ${MOGPLEX_GH_CONFIG_DIR}
mkdir -p ${MOGPLEX_STATE_DIR}
chmod 700 ${MOGPLEX_STATE_DIR} 2>/dev/null || true
chmod 700 ${MOGPLEX_BIN_DIR} 2>/dev/null || true
chmod 700 ${MOGPLEX_GH_CONFIG_DIR} 2>/dev/null || true
case ":$PATH:" in
  *:"$HOME/.local/bin":*) ;;
  *) export PATH="$HOME/.local/bin:$PATH" ;;
esac
if ! grep -Fq 'HOME/.local/bin' "$HOME/.bashrc" 2>/dev/null; then
  echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.bashrc"
fi
if ! grep -Fq ${q(MOGPLEX_GITHUB_HOOK_START)} "$HOME/.bashrc" 2>/dev/null; then
  ${githubHook}
fi
${ghWrapper}

${
  ensureTmux
    ? `_mogplex_pkg_run() {
  # Package installs need root. Try direct first (we might be root), then
  # passwordless sudo. Never prompt — this runs without a TTY.
  if [ "$(id -u)" = 0 ]; then
    "$@"
    return $?
  fi
  if command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
    sudo -n "$@"
    return $?
  fi
  echo "[mogplex] need root or passwordless sudo for: $*" >&2
  return 1
}
if ! command -v tmux >/dev/null 2>&1; then
  if command -v dnf >/dev/null 2>&1; then
    _mogplex_pkg_run dnf install -y tmux || echo "tmux install failed via dnf" >&2
  elif command -v yum >/dev/null 2>&1; then
    _mogplex_pkg_run yum install -y tmux || echo "tmux install failed via yum" >&2
  elif command -v apt-get >/dev/null 2>&1; then
    _mogplex_pkg_run env DEBIAN_FRONTEND=noninteractive apt-get update || true
    _mogplex_pkg_run env DEBIAN_FRONTEND=noninteractive apt-get install -y tmux || echo "tmux install failed via apt-get" >&2
  elif command -v apk >/dev/null 2>&1; then
    _mogplex_pkg_run apk add --no-cache tmux || echo "tmux install failed via apk" >&2
  else
    echo "no supported package manager available; skipping tmux install" >&2
  fi
fi

`
    : ""
}if [ ! -x ${dq(MOGPLEX_GH_REAL_BIN)} ] || ! ${dq(MOGPLEX_GH_REAL_BIN)} --version 2>/dev/null | grep -Fq ${q(`gh version ${ghVersion}`)}; then
  tarball_name="gh_${ghVersion}_${ghArch}"
  tarball_url="https://github.com/cli/cli/releases/download/v${ghVersion}/\${tarball_name}.tar.gz"
  work_dir="$(mktemp -d)"
  gh_downloaded=false
  if command -v curl >/dev/null 2>&1; then
    if curl -fsSL "$tarball_url" -o "$work_dir/gh.tar.gz"; then
      gh_downloaded=true
    else
      echo "gh download failed; skipping gh install"
    fi
  elif command -v wget >/dev/null 2>&1; then
    if wget -qO "$work_dir/gh.tar.gz" "$tarball_url"; then
      gh_downloaded=true
    else
      echo "gh download failed; skipping gh install"
    fi
  else
    echo "no curl/wget available; skipping gh install"
  fi
  if [ "$gh_downloaded" = true ]; then
    tar -xzf "$work_dir/gh.tar.gz" -C "$work_dir"
    mv "$work_dir/\${tarball_name}/bin/gh" ${dq(MOGPLEX_GH_REAL_BIN)}
    chmod +x ${dq(MOGPLEX_GH_REAL_BIN)}
  fi
  rm -rf "$work_dir"
fi

current_git_name="$(git config --global --get user.name 2>/dev/null || true)"
current_git_email="$(git config --global --get user.email 2>/dev/null || true)"
case "$current_git_email" in
  ""|${q(DEFAULT_AGENT_EMAIL)}|${q(LEGACY_AGENT_EMAIL)})
    git config --global user.name ${q(agentName)}
    git config --global user.email ${q(agentEmail)}
    ;;
  *)
    if [ -z "$current_git_name" ]; then
      git config --global user.name ${q(agentName)}
    fi
    ;;
esac
git config --global credential.helper '!f() { token_file="${MOGPLEX_GITHUB_TOKEN_FILE}"; token=""; if [ -r "$token_file" ]; then token="$(cat "$token_file" 2>/dev/null || true)"; fi; if [ -z "$token" ]; then token="\${GITHUB_TOKEN:-$GH_TOKEN}"; fi; echo username=x-access-token; echo "password=$token"; }; f'
git config --global --replace-all url."https://github.com/".insteadOf "git@github.com:"

${
  ensureTmux
    ? `if command -v tmux >/dev/null 2>&1; then
  echo "${TMUX_AVAILABILITY_SENTINEL}=1"
  tmux -V
else
  echo "${TMUX_AVAILABILITY_SENTINEL}=0"
  echo "tmux unavailable after install attempt — session persistence disabled" >&2
fi
`
    : ""
}${
    requireTmux
      ? `if ! command -v tmux >/dev/null 2>&1; then
  exit 1
fi
`
      : ""
  }GH_CONFIG_DIR=${dq(MOGPLEX_GH_CONFIG_DIR)} ${dq(MOGPLEX_GH_REAL_BIN)} --version || true
git --version
`;
}

export function buildSyncTerminalRuntimeAuthScript(options: {
  githubToken?: string | null;
}) {
  const q = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;
  const dq = (value: string) =>
    `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
  const githubToken =
    typeof options.githubToken === "string" && options.githubToken.length > 0
      ? options.githubToken
      : null;

  return `
set -u
mkdir -p ${MOGPLEX_STATE_DIR}
mkdir -p ${MOGPLEX_GH_CONFIG_DIR}
chmod 700 ${MOGPLEX_STATE_DIR} 2>/dev/null || true
chmod 700 ${MOGPLEX_GH_CONFIG_DIR} 2>/dev/null || true
token_file=${dq(MOGPLEX_GITHUB_TOKEN_FILE)}
gh_config_dir=${dq(MOGPLEX_GH_CONFIG_DIR)}
gh_hosts_file="$gh_config_dir/hosts.yml"
${
  githubToken
    ? `printf %s ${q(githubToken)} > "$token_file"
chmod 600 "$token_file"
cat <<'EOF' > "$gh_hosts_file"
github.com:
  user: x-access-token
  oauth_token: ${githubToken}
  git_protocol: https
EOF
chmod 600 "$gh_hosts_file"
`
    : `rm -f "$token_file"
rm -f "$gh_hosts_file"
`
}if command -v tmux >/dev/null 2>&1; then
  if [ -n "$(tmux list-sessions 2>/dev/null || true)" ]; then
    tmux set-environment -g GH_CONFIG_DIR ${dq(MOGPLEX_GH_CONFIG_DIR)} || true
    tmux set-environment -g MOGPLEX_GITHUB_TOKEN_FILE "$token_file" || true
    ${
      githubToken
        ? `tmux set-environment -g GITHUB_TOKEN ${q(githubToken)} || true
    tmux set-environment -g GH_TOKEN ${q(githubToken)} || true`
        : `tmux set-environment -gu GITHUB_TOKEN || true
    tmux set-environment -gu GH_TOKEN || true`
    }
  fi
fi
`;
}

async function collectCommandLogs(command: {
  logs: () => AsyncIterable<{ stream: string; data: string }>;
}): Promise<string> {
  const chunks: string[] = [];
  for await (const log of command.logs()) {
    chunks.push(log.data);
  }
  return chunks.join("");
}

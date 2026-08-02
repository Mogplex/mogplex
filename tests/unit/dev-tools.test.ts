import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  buildEnsureDevToolsScript,
  buildSyncTerminalRuntimeAuthScript,
  parseTmuxAvailability,
  TMUX_AVAILABILITY_SENTINEL,
} from "../../lib/sandbox/dev-tools";

const execFile = promisify(execFileCallback);

async function createSandboxHome() {
  const home = await mkdtemp(path.join(tmpdir(), "mogplex-dev-tools-"));
  const binDir = path.join(home, ".mogplex", "bin");
  await mkdir(binDir, { recursive: true });
  const ghReal = path.join(binDir, "gh-real");
  await writeFile(ghReal, "#!/bin/sh\necho 'gh version 2.65.0'\n");
  await chmod(ghReal, 0o755);
  return home;
}

function testEnv(home: string) {
  return {
    ...process.env,
    HOME: home,
    GIT_CONFIG_GLOBAL: path.join(home, ".gitconfig"),
    XDG_CONFIG_HOME: path.join(home, ".config"),
  };
}

async function readGlobalGitConfig(
  home: string,
  key: "user.name" | "user.email"
) {
  const { stdout } = await execFile(
    "git",
    ["config", "--global", "--get", key],
    {
      env: testEnv(home),
    }
  );
  return stdout.trim();
}

test("buildEnsureDevToolsScript embeds the pinned gh version", () => {
  const script = buildEnsureDevToolsScript({
    ghVersion: "2.65.0",
    ghArch: "linux_amd64",
    agentName: "bot",
    agentEmail: "bot@example.com",
  });

  assert.match(
    script,
    /gh_\$\{?2\.65\.0\}?_linux_amd64|gh_2\.65\.0_linux_amd64/
  );
  assert.match(
    script,
    /https:\/\/github\.com\/cli\/cli\/releases\/download\/v\$\{?ghVersion\}?|v2\.65\.0/
  );
});

test("buildEnsureDevToolsScript refreshes missing or managed git identities", () => {
  const script = buildEnsureDevToolsScript({
    ghVersion: "2.65.0",
    ghArch: "linux_amd64",
    agentName: "bot",
    agentEmail: "bot@example.com",
  });

  assert.match(script, /current_git_name=/);
  assert.match(script, /current_git_email=/);
  assert.match(script, /bot@mogplex\.dev/);
  assert.match(script, /mogplex-agent\[bot\]@users\.noreply\.github\.com/);
});

test("buildEnsureDevToolsScript replaces stale Mogplex bot git identity", async () => {
  const home = await createSandboxHome();
  try {
    const env = testEnv(home);
    await execFile("git", ["config", "--global", "user.name", "Mogplex Bot"], {
      env,
    });
    await execFile(
      "git",
      ["config", "--global", "user.email", "bot@mogplex.dev"],
      {
        env,
      }
    );

    await execFile(
      "sh",
      [
        "-lc",
        buildEnsureDevToolsScript({
          ghVersion: "2.65.0",
          ghArch: "linux_amd64",
          agentName: "Alice Example",
          agentEmail: "123+alice@users.noreply.github.com",
        }),
      ],
      { env, timeout: 15_000 }
    );

    assert.equal(await readGlobalGitConfig(home, "user.name"), "Alice Example");
    assert.equal(
      await readGlobalGitConfig(home, "user.email"),
      "123+alice@users.noreply.github.com"
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("buildEnsureDevToolsScript preserves user-custom git identity", async () => {
  const home = await createSandboxHome();
  try {
    const env = testEnv(home);
    await execFile("git", ["config", "--global", "user.name", "Custom User"], {
      env,
    });
    await execFile(
      "git",
      ["config", "--global", "user.email", "custom@example.com"],
      { env }
    );

    await execFile(
      "sh",
      [
        "-lc",
        buildEnsureDevToolsScript({
          ghVersion: "2.65.0",
          ghArch: "linux_amd64",
          agentName: "Alice Example",
          agentEmail: "123+alice@users.noreply.github.com",
        }),
      ],
      { env, timeout: 15_000 }
    );

    assert.equal(await readGlobalGitConfig(home, "user.name"), "Custom User");
    assert.equal(
      await readGlobalGitConfig(home, "user.email"),
      "custom@example.com"
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("buildEnsureDevToolsScript escapes single quotes in identity fields", () => {
  const script = buildEnsureDevToolsScript({
    ghVersion: "2.65.0",
    ghArch: "linux_amd64",
    agentName: "O'Brien Agent",
    agentEmail: "o'brien@example.com",
  });

  // Expect each single quote to be closed, escaped, and reopened so the
  // surrounding single-quoted literal stays intact.
  assert.ok(
    script.includes(`'O'\\''Brien Agent'`),
    "expected agent name to be quote-escaped"
  );
  assert.ok(
    script.includes(`'o'\\''brien@example.com'`),
    "expected agent email to be quote-escaped"
  );
});

test("buildEnsureDevToolsScript wires the git credential helper to env token", () => {
  const script = buildEnsureDevToolsScript({
    ghVersion: "2.65.0",
    ghArch: "linux_amd64",
    agentName: "bot",
    agentEmail: "bot@example.com",
  });

  assert.match(script, /credential\.helper/);
  assert.match(script, /username=x-access-token/);
  assert.match(script, /github-token/);
  assert.match(script, /GITHUB_TOKEN/);
});

test("buildEnsureDevToolsScript installs the managed gh wrapper and shell hook", () => {
  const script = buildEnsureDevToolsScript({
    ghVersion: "2.65.0",
    ghArch: "linux_amd64",
    agentName: "bot",
    agentEmail: "bot@example.com",
  });

  assert.match(script, /_mogplex_refresh_github_auth/);
  assert.match(script, /case ";\$PROMPT_COMMAND;" in/);
  assert.match(script, /export GH_CONFIG_DIR="\$HOME\/\.mogplex\/gh"/);
  assert.match(script, /cat <<'EOF' > "\$HOME\/\.local\/bin\/gh"/);
  assert.match(script, /exec "\$HOME\/\.mogplex\/bin\/gh-real" "\$@"/);
});

test("buildEnsureDevToolsScript skips gh install when already on PATH", () => {
  const script = buildEnsureDevToolsScript({
    ghVersion: "2.65.0",
    ghArch: "linux_amd64",
    agentName: "bot",
    agentEmail: "bot@example.com",
  });

  assert.match(
    script,
    /\[ ! -x "\$HOME\/\.mogplex\/bin\/gh-real" \] \|\| ! "\$HOME\/\.mogplex\/bin\/gh-real" --version/
  );
});

test("buildEnsureDevToolsScript falls through to git config when gh install fails", () => {
  const script = buildEnsureDevToolsScript({
    ghVersion: "2.65.0",
    ghArch: "linux_amd64",
    agentName: "bot",
    agentEmail: "bot@example.com",
  });

  // Failure paths inside the gh install block must fall through to the git
  // credential/identity setup below, otherwise a missing curl/wget silently
  // breaks `git push` auth.
  assert.match(script, /gh_downloaded=false/);
  const ghInstallEnd = script.lastIndexOf("fi\n\ncurrent_git_name=");
  assert.ok(
    ghInstallEnd !== -1,
    "expected git identity setup to follow the gh install `fi`"
  );
  assert.ok(
    script.indexOf("git config --global credential.helper", ghInstallEnd) >
      ghInstallEnd,
    "expected credential helper setup after git identity setup"
  );
});

test("buildEnsureDevToolsScript attempts tmux install with sudo fallback and emits an availability sentinel", () => {
  const script = buildEnsureDevToolsScript({
    ghVersion: "2.65.0",
    ghArch: "linux_amd64",
    agentName: "bot",
    agentEmail: "bot@example.com",
    ensureTmux: true,
    requireTmux: false,
  });

  assert.match(script, /if ! command -v tmux >\/dev\/null 2>&1; then/);
  assert.match(
    script,
    /dnf install -y tmux|apt-get install -y tmux|apk add --no-cache tmux/
  );
  // Installs must run as root or via passwordless sudo — never prompt.
  assert.match(script, /_mogplex_pkg_run/);
  assert.match(script, /sudo -n true/);
  // Sentinel lets the TS side parse whether the sandbox ended up with tmux.
  assert.match(script, new RegExp(`${TMUX_AVAILABILITY_SENTINEL}=1`));
  assert.match(script, new RegExp(`${TMUX_AVAILABILITY_SENTINEL}=0`));
  assert.match(script, /tmux -V/);
});

test("buildEnsureDevToolsScript with requireTmux still exits non-zero when tmux is missing", () => {
  const script = buildEnsureDevToolsScript({
    ghVersion: "2.65.0",
    ghArch: "linux_amd64",
    agentName: "bot",
    agentEmail: "bot@example.com",
    ensureTmux: true,
    requireTmux: true,
  });

  // The strict guard stays available for callers that truly need tmux.
  assert.match(
    script,
    /if ! command -v tmux >\/dev\/null 2>&1; then\s*\n\s*exit 1/
  );
});

test("parseTmuxAvailability reads the last MOGPLEX_TMUX_AVAILABLE sentinel", () => {
  assert.equal(parseTmuxAvailability(""), undefined);
  assert.equal(parseTmuxAvailability("noise\nno sentinel here\n"), undefined);
  assert.equal(parseTmuxAvailability("MOGPLEX_TMUX_AVAILABLE=1\n"), true);
  assert.equal(parseTmuxAvailability("MOGPLEX_TMUX_AVAILABLE=0\n"), false);
  // Multiple runs — last one wins.
  assert.equal(
    parseTmuxAvailability(
      "MOGPLEX_TMUX_AVAILABLE=0\nsome output\nMOGPLEX_TMUX_AVAILABLE=1\n"
    ),
    true
  );
  // Must not match when followed by other chars (defensive against noise).
  assert.equal(parseTmuxAvailability("MOGPLEX_TMUX_AVAILABLE=12"), undefined);
});

test("buildSyncTerminalRuntimeAuthScript updates token file, gh config, and tmux env", () => {
  const script = buildSyncTerminalRuntimeAuthScript({
    githubToken: "ghs_example",
  });

  assert.match(script, /github-token/);
  assert.match(script, /hosts\.yml/);
  assert.match(script, /oauth_token: ghs_example/);
  assert.match(
    script,
    /tmux set-environment -g GH_CONFIG_DIR "\$HOME\/\.mogplex\/gh"/
  );
  assert.match(script, /tmux set-environment -g GITHUB_TOKEN 'ghs_example'/);
});

test("buildSyncTerminalRuntimeAuthScript removes managed auth when token missing", () => {
  const script = buildSyncTerminalRuntimeAuthScript({
    githubToken: null,
  });

  assert.match(script, /rm -f "\$token_file"/);
  assert.match(script, /rm -f "\$gh_hosts_file"/);
  assert.match(script, /tmux set-environment -gu GITHUB_TOKEN/);
  assert.match(script, /tmux set-environment -gu GH_TOKEN/);
});

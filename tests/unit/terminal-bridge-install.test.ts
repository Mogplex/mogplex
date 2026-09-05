import assert from "node:assert/strict";
import test from "node:test";
import {
  __resetTerminalBridgeCacheForTesting,
  bridgeTokensMatch,
  ensureTerminalBridgeInstalled,
  generateBridgeToken,
  installTerminalBridgeOnce,
  TERMINAL_BRIDGE_SCRIPT_PATH,
} from "../../lib/sandbox/terminal-bridge-install";

type WrittenFile = { path: string; content: Buffer };

function buildSandboxMock(
  opts: {
    sandboxId?: string;
    healthResponses?: string[];
  } = {}
) {
  // SandboxLike renamed sandboxId → name in the v2 migration; keep the
  // test option key as `sandboxId` for readability but emit `name` on
  // the mock object so it satisfies the current type.
  const name = opts.sandboxId ?? "sb_test_1";
  const healthResponses = [...(opts.healthResponses ?? ['{"ok":true}'])];
  const commands: string[] = [];
  const writes: WrittenFile[][] = [];

  return {
    name,
    commands,
    writes,
    async writeFiles(files: WrittenFile[]) {
      writes.push(files);
    },
    async runCommand(input: { cmd: string; args: string[] }) {
      commands.push(input.args[input.args.length - 1]);
      const script = input.args[input.args.length - 1] ?? "";
      if (script.includes("/health")) {
        const response = healthResponses.shift() ?? "";
        return {
          stdout: async () => response,
          stderr: async () => "",
          exitCode: 0,
        };
      }
      return {
        stdout: async () => "MOGPLEX_TERMINAL_BRIDGE_READY",
        stderr: async () => "",
        exitCode: 0,
      };
    },
  };
}

test("generateBridgeToken produces distinct base64url strings", () => {
  const a = generateBridgeToken();
  const b = generateBridgeToken();
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9_-]+$/);
  assert.ok(a.length >= 40);
});

test("installTerminalBridgeOnce writes the runtime and starts the bridge", async () => {
  const sandbox = buildSandboxMock({ sandboxId: "sb_install_1" });
  const installation = await installTerminalBridgeOnce(sandbox, {
    source: "/* stub bridge */",
  });

  assert.equal(installation.sandboxRuntimeId, "sb_install_1");
  assert.equal(installation.port, 4020);
  assert.match(installation.token, /^[A-Za-z0-9_-]+$/);
  assert.match(installation.configSignature, /^[a-f0-9]{64}$/);

  assert.equal(sandbox.writes.length, 1);
  assert.equal(sandbox.writes[0][0].path, TERMINAL_BRIDGE_SCRIPT_PATH);
  assert.ok(
    sandbox.commands.some(
      (c) => c.includes("node -e") && c.includes(TERMINAL_BRIDGE_SCRIPT_PATH)
    ),
    "expected event-driven bridge launcher"
  );
  assert.ok(
    sandbox.commands.some((c) => c.includes("pkill")),
    "expected pkill of any prior bridge"
  );
});

test("bridge cleanup cannot terminate its own Linux startup shell", async () => {
  const sandbox = buildSandboxMock();
  const runCommand = sandbox.runCommand.bind(sandbox);
  sandbox.runCommand = async (input) => {
    const script = input.args.at(-1) ?? "";
    const cleanupPattern = script.match(/pkill -f '([^']+)'/)?.[1];
    // Linux pkill matches a process's full command line, including the
    // ancestor shell executing this script. macOS excludes ancestors.
    if (cleanupPattern && new RegExp(cleanupPattern).test(`sh -lc ${script}`)) {
      throw new Error("startup shell terminated by its own cleanup (SIGTERM)");
    }
    return runCommand(input);
  };

  const installation = await installTerminalBridgeOnce(sandbox, {
    source: "/* stub bridge */",
  });
  assert.equal(installation.sandboxRuntimeId, sandbox.name);
});

test("installTerminalBridgeOnce injects sanitized bridge env into the start command", async () => {
  const sandbox = buildSandboxMock({ sandboxId: "sb_install_env" });
  await installTerminalBridgeOnce(sandbox, {
    source: "/* stub bridge */",
    env: {
      OPENAI_API_KEY: "sk-test",
      PATH: "/tmp/ignored",
      "BAD-NAME": "ignored",
    },
  });

  const startCommand = sandbox.commands.find((command) =>
    command.includes("node -e")
  );
  assert.ok(startCommand, "expected bridge start command");
  assert.match(startCommand, /OPENAI_API_KEY='sk-test'/);
  assert.ok(!startCommand.includes("PATH='/tmp/ignored'"));
  assert.ok(!startCommand.includes("BAD-NAME"));
});

test("installTerminalBridgeOnce throws when health probe never succeeds", async () => {
  const sandbox = buildSandboxMock({
    sandboxId: "sb_health_fail",
    healthResponses: Array.from<string>({ length: 80 }).fill(""),
  });
  await assert.rejects(
    installTerminalBridgeOnce(sandbox, { source: "/* stub */" }),
    /failed to become ready/
  );
  assert.equal(
    sandbox.commands.filter((command) => command.includes("/health")).length,
    1
  );
});

test("bridge startup failure is reported immediately without probing or leaking output", async () => {
  let commands = 0;
  const sandbox = {
    name: "failed-start",
    writeFiles: async () => {},
    runCommand: async () => {
      commands += 1;
      return { exitCode: 143, stdout: async () => "private child output" };
    },
  };
  await assert.rejects(
    installTerminalBridgeOnce(sandbox, { source: "/* stub */" }),
    {
      message: "terminal bridge startup failed before readiness",
    }
  );
  assert.equal(commands, 1);
});

test("ensureTerminalBridgeInstalled caches per sandbox runtime id", async () => {
  __resetTerminalBridgeCacheForTesting();
  const sandbox = buildSandboxMock({ sandboxId: "sb_cache_1" });
  const first = await ensureTerminalBridgeInstalled(sandbox, {
    source: "/* a */",
  });
  const second = await ensureTerminalBridgeInstalled(sandbox, {
    source: "/* a */",
  });
  assert.equal(first, second);
  assert.equal(sandbox.writes.length, 1, "install should run only once");
});

test("ensureTerminalBridgeInstalled dedupes concurrent installs", async () => {
  __resetTerminalBridgeCacheForTesting();
  const sandbox = buildSandboxMock({
    sandboxId: "sb_concurrent_1",
    healthResponses: ['{"ok":true}', '{"ok":true}'],
  });
  const [a, b] = await Promise.all([
    ensureTerminalBridgeInstalled(sandbox, { source: "/* a */" }),
    ensureTerminalBridgeInstalled(sandbox, { source: "/* a */" }),
  ]);
  assert.equal(a, b);
  assert.equal(sandbox.writes.length, 1);
});

test("ensureTerminalBridgeInstalled reinstalls when bridge env changes", async () => {
  __resetTerminalBridgeCacheForTesting();
  const sandbox = buildSandboxMock({
    sandboxId: "sb_cache_env",
    healthResponses: ['{"ok":true}', '{"ok":true}'],
  });

  const first = await ensureTerminalBridgeInstalled(sandbox, {
    source: "/* a */",
    env: { OPENAI_API_KEY: "first" },
  });
  const second = await ensureTerminalBridgeInstalled(sandbox, {
    source: "/* a */",
    env: { OPENAI_API_KEY: "second" },
  });

  assert.notEqual(first.token, second.token);
  assert.notEqual(first.configSignature, second.configSignature);
  assert.equal(sandbox.writes.length, 2);
});

test("bridgeTokensMatch is constant-time-ish on equal-length inputs", () => {
  const t = generateBridgeToken();
  assert.equal(bridgeTokensMatch(t, t), true);
  assert.equal(bridgeTokensMatch(t, t.slice(0, -1) + "X"), false);
  assert.equal(bridgeTokensMatch(t, t + "X"), false);
  assert.equal(bridgeTokensMatch("", t), false);
});

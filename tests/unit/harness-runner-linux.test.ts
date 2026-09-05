import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runHarness } from "../../lib/harness/runner";

// Execute the launch request at the external sandbox boundary. The fixture
// replaces only the paid CLI, not setpriv or the kernel's capability handling.
const linuxOnly = {
  skip: process.platform !== "linux" && "Linux kernel required",
};
const fixture = `#!${process.execPath}
const fs = require('node:fs');
console.log(JSON.stringify({
  args: process.argv.slice(2), cwd: process.cwd(),
  key: process.env.CODEX_API_KEY, runtime: process.env.MOGPLEX_TEST_RUNTIME,
  uid: process.getuid(),
  status: Object.fromEntries(fs.readFileSync('/proc/self/status', 'utf8')
    .split('\\n').filter(line => /^(Cap(Inh|Prm|Eff|Amb)|NoNewPrivs):/.test(line))
    .map(line => line.split(':').map(part => part.trim())))
}));
`;

async function localSandbox(path: string) {
  const cwd = await mkdtemp(join(tmpdir(), "harness-capabilities-"));
  await writeFile(join(cwd, "codex"), fixture, { mode: 0o755 });
  return {
    cwd,
    sandbox: {
      async readFile() {
        return Buffer.from("installed");
      },
      async runCommand(input: {
        cmd: string;
        args?: string[];
        cwd?: string;
        env?: Record<string, string>;
        detached?: boolean;
      }) {
        assert.equal(input.detached, true);
        const result = spawnSync(input.cmd, input.args, {
          cwd: input.cwd,
          env: { ...process.env, ...input.env, PATH: `${cwd}${path}` },
          encoding: "utf8",
        });
        if (result.error) throw result.error;
        return {
          exitCode: result.status,
          stdout: async () => result.stdout,
          stderr: async () => result.stderr,
        };
      },
    },
  };
}

test(
  "Codex launches without inherited capabilities and preserves execution context",
  linuxOnly,
  async () => {
    const { cwd, sandbox } = await localSandbox(":/usr/bin:/bin");
    try {
      const prompt = "inspect 'quoted' input; $(do-not-execute)";
      const { command } = await runHarness(
        sandbox as never,
        "codex",
        prompt,
        {
          CODEX_API_KEY: "fixture-key",
          OPENAI_BASE_URL: "https://ai-gateway.vercel.sh/v1",
        },
        {
          cwd,
          mode: "AUTO",
          resumeSessionId: "fixture-session",
          runtimeEnv: { MOGPLEX_TEST_RUNTIME: "retained" },
        }
      );
      assert.equal(command.exitCode, 0, await command.stderr());
      const observed = JSON.parse(await command.stdout()) as {
        args: string[];
        cwd: string;
        key: string;
        runtime: string;
        uid: number;
        status: Record<string, string>;
      };
      assert.equal(observed.status.NoNewPrivs, "1");
      // Provider workers are non-root. Root callers can retain permitted
      // capabilities; neither caller may pass inheritable/ambient ones on.
      const fields =
        observed.uid === 0
          ? ["CapInh", "CapAmb"]
          : ["CapInh", "CapPrm", "CapEff", "CapAmb"];
      for (const field of fields) {
        assert.match(observed.status[field], /^0+$/, field);
      }
      assert.equal(observed.uid, process.getuid?.());
      assert.equal(observed.cwd, cwd);
      assert.equal(observed.key, "fixture-key");
      assert.equal(observed.runtime, "retained");
      assert.deepEqual(observed.args.slice(-5), [
        "exec",
        "resume",
        "--json",
        "fixture-session",
        prompt,
      ]);
      assert.ok(observed.args.includes('sandbox_mode="workspace-write"'));
      assert.ok(observed.args.includes('approval_policy="never"'));
      assert.ok(observed.args.includes('model_provider="mogplex_gateway"'));
      assert.equal(observed.args.includes("fixture-key"), false);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  }
);

for (const [mode, policy] of [
  ["SAFE", "read-only"],
  ["AUTO", "workspace-write"],
  ["YOLO", "danger-full-access"],
] as const) {
  test(
    `Codex retains ${mode} policy for a fresh launch`,
    linuxOnly,
    async () => {
      const { cwd, sandbox } = await localSandbox(":/usr/bin:/bin");
      try {
        const { command } = await runHarness(
          sandbox as never,
          "codex",
          "inspect",
          "fixture-key",
          { cwd, mode }
        );
        assert.equal(command.exitCode, 0, await command.stderr());
        const observed = JSON.parse(await command.stdout()) as {
          args: string[];
        };
        assert.ok(observed.args.includes(`sandbox_mode="${policy}"`));
        assert.ok(observed.args.includes('approval_policy="never"'));
        assert.deepEqual(observed.args.slice(-3), [
          "exec",
          "--json",
          "inspect",
        ]);
        assert.equal(
          observed.args.includes("--dangerously-bypass-approvals-and-sandbox"),
          false
        );
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    }
  );
}

test(
  "Codex fails closed when capability isolation is unavailable",
  linuxOnly,
  async () => {
    const { cwd, sandbox } = await localSandbox("");
    try {
      await assert.rejects(
        runHarness(sandbox as never, "codex", "inspect", "fixture-key", {
          cwd,
        }),
        { code: "ENOENT" }
      );
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  }
);

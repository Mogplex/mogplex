import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { Sandbox } from "@vercel/sandbox";
import { prepareTaskWorkspace } from "../../lib/workflows/automation-task-workspace";
import { buildScheduledTaskTools } from "../../lib/agents/scheduled-task";
import { patchNextConfigContent } from "../../lib/sandbox/runtimes/next-config-patch";

test("native task commands have gh and exclude boot artifacts from commits while preserving user edits", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mogplex-task-workspace-"));
  const home = path.join(root, "home");
  const repo = path.join(root, "repo");
  const cwd = path.join(repo, "apps/web");
  const env = {
    ...process.env,
    HOME: home,
    GIT_CONFIG_GLOBAL: path.join(home, ".gitconfig"),
    GIT_CONFIG_NOSYSTEM: "1",
  };
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: repo, env, encoding: "utf8" }).trim();
  try {
    await mkdir(path.join(home, ".mogplex/bin"), { recursive: true });
    await mkdir(cwd, { recursive: true });
    const gh = path.join(home, ".mogplex/bin/gh-real");
    await writeFile(gh, "#!/bin/sh\necho 'gh version 2.65.0'\n");
    await chmod(gh, 0o755);
    git("init", "--initial-branch=main");
    git("config", "user.name", "Test");
    git("config", "user.email", "test@example.test");
    git("config", "commit.gpgsign", "false");
    const original =
      "const config = {\n  reactStrictMode: true,\n};\nexport default config;\n";
    const config = path.join(cwd, "next.config.mjs");
    await writeFile(config, original);
    await writeFile(path.join(cwd, "user.txt"), "original\n");
    git("add", ".");
    git("commit", "-m", "initial");
    const patch = patchNextConfigContent(original);
    assert.equal(patch.kind, "patched");
    await writeFile(config, patch.content);
    await mkdir(path.join(cwd, ".mogplex"));
    await writeFile(path.join(cwd, ".mogplex/dev.log"), "booted\n");
    await writeFile(path.join(cwd, "user.txt"), "user edit\n");
    // Run real generated shell scripts; only the remote VM transport is replaced.
    const sandbox = {
      runCommand: async (input: {
        cmd: string;
        args: string[];
        cwd?: string;
        env?: Record<string, string>;
      }) => {
        const stdout = execFileSync(input.cmd, ["-c", input.args[1]], {
          cwd: input.cwd ?? repo,
          env: { ...env, ...input.env },
          encoding: "utf8",
        });
        return {
          exitCode: 0,
          stdout: async () => stdout,
          stderr: async () => "",
          wait: async () => ({ exitCode: 0 }),
          async *logs() {
            yield { stream: "stdout", data: stdout };
          },
        };
      },
    } as unknown as Sandbox;
    await prepareTaskWorkspace(sandbox, {
      cwd,
      githubToken: "fixture-token",
      author: { name: "Test", email: "test@example.test" },
    });
    const tools = buildScheduledTaskTools({
      githubToken: "fixture-token",
      loadSandbox: async () => ({ sandbox, cwd }),
    });
    const result = (await tools.runCommand.execute!(
      { command: "gh --version && git add . && git diff --cached --name-only" },
      { toolCallId: "task", messages: [] }
    )) as { stdout: string; exitCode: number };
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /gh version 2\.65\.0/);
    assert.equal(git("diff", "--cached", "--name-only"), "apps/web/user.txt");
    assert.equal(await readFile(config, "utf8"), original);
    assert.equal(
      await readFile(path.join(cwd, "user.txt"), "utf8"),
      "user edit\n"
    );
    assert.match(
      await readFile(path.join(home, ".mogplex/gh/hosts.yml"), "utf8"),
      /oauth_token: fixture-token/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("native tasks surface workspace preparation failures before running a command", async () => {
  const sandbox = {
    runCommand: async () => {
      throw new Error("provider unavailable");
    },
  } as unknown as Sandbox;
  await assert.rejects(
    prepareTaskWorkspace(sandbox, {
      githubToken: "fixture-token",
      author: { name: "Test", email: "test@example.test" },
    }),
    /Task workspace tools could not be prepared/
  );
});

for (const scenario of [
  { failedCommand: 2, message: /Task workspace GitHub access is unavailable/ },
  { failedCommand: 3, message: /Task workspace could not be prepared/ },
]) {
  test(`native task preparation stops on command ${scenario.failedCommand} failure`, async () => {
    let commands = 0;
    const sandbox = {
      runCommand: async () => {
        commands += 1;
        const exitCode = commands === scenario.failedCommand ? 1 : 0;
        return {
          exitCode,
          wait: async () => ({ exitCode }),
          async *logs() {
            yield { stream: "stderr", data: "" };
          },
        };
      },
    } as unknown as Sandbox;
    await assert.rejects(
      prepareTaskWorkspace(sandbox, {
        githubToken: "fixture-token",
        author: { name: "Test", email: "test@example.test" },
      }),
      scenario.message
    );
    assert.equal(commands, scenario.failedCommand);
  });
}

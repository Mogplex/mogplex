import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { buildSandboxPRFixTools } from "../../lib/agents/pr-fixer";

const execFile = promisify(execFileCallback);

test("PR autofix pushes commits attributed to the acting GitHub user", async () => {
  const checkout = await mkdtemp(
    path.join(tmpdir(), "mogplex-autofix-author-")
  );
  const remote = await mkdtemp(path.join(tmpdir(), "mogplex-autofix-remote-"));
  const env = {
    NODE_ENV: "test" as const,
    PATH: process.env.PATH,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
  };
  const git = (args: string[]) => execFile("git", args, { cwd: checkout, env });
  try {
    await git(["init", "--quiet"]);
    await git(["init", "--bare", "--quiet", remote]);
    await git(["remote", "add", "origin", remote]);
    await git([
      "config",
      `url.${remote}.insteadOf`,
      "https://x-access-token:test@github.com/acme/widget.git",
    ]);
    await git(["config", "commit.gpgsign", "false"]);
    const sandbox = {
      readFileToBuffer: ({ path: filename }: { path: string }) =>
        readFile(path.join(checkout, filename)),
      writeFiles: async (files: Array<{ path: string; content: Buffer }>) => {
        for (const file of files)
          await writeFile(path.join(checkout, file.path), file.content);
      },
      runCommand: async (input: {
        cmd: string;
        args?: string[];
        env?: Record<string, string>;
      }) => {
        const result = await execFile(input.cmd, input.args ?? [], {
          cwd: checkout,
          env: { ...env, ...input.env },
        });
        return {
          exitCode: 0,
          stdout: async () => result.stdout,
          stderr: async () => result.stderr,
        };
      },
    };
    const tools = buildSandboxPRFixTools({
      githubToken: "test",
      owner: "acme",
      repo: "widget",
      headOwner: "acme",
      headRepo: "widget",
      prNumber: 1,
      branch: "fix/widget",
      sandbox: sandbox as never,
      gitAuthor: {
        name: "GitHub User",
        email: "123+user@users.noreply.github.com",
      },
    });
    const updateFile = tools.updateFile as unknown as {
      execute: (input: {
        path: string;
        content: string;
        message: string;
      }) => Promise<{ success: boolean }>;
    };
    assert.equal(
      (
        await updateFile.execute({
          path: "widget.txt",
          content: "fixed\n",
          message: "Fix widget",
        })
      ).success,
      true
    );
    const { stdout } = await execFile(
      "git",
      [
        "--git-dir",
        remote,
        "log",
        "fix/widget",
        "-1",
        "--format=%an|%ae|%cn|%ce",
      ],
      { env }
    );
    assert.equal(
      stdout.trim(),
      "GitHub User|123+user@users.noreply.github.com|GitHub User|123+user@users.noreply.github.com"
    );
  } finally {
    await rm(checkout, { recursive: true, force: true });
    await rm(remote, { recursive: true, force: true });
  }
});

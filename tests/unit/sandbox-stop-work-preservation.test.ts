import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createStopSandbox } from "@/lib/agents/tools/sandbox";

const exec = promisify(execFile);

for (const [changedPath, shouldStop] of [
  ["README.md", false],
  ["packages/shared/index.ts", false],
  ["next.config.ts", false],
  ["apps/web/next.config.mjs", false],
  [".mogplex/runtime.json", true],
  ["apps/web/.mogplex/runtime.json", true],
] as const) {
  test(`sandbox stop checks ${changedPath} when launched in apps/web`, async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sandbox-stop-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const cwd = path.join(root, "apps/web");
    await mkdir(cwd, { recursive: true });
    const filePath = path.join(root, changedPath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, "original\n");
    await exec("git", ["init", "--quiet", root]);
    await exec("git", ["add", "."], { cwd: root });
    await exec(
      "git",
      [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "--quiet",
        "-m",
        "fixture",
      ],
      { cwd: root }
    );
    await writeFile(filePath, "operator edit\n");

    const originalSecret = process.env.INTERNAL_API_SECRET;
    process.env.INTERNAL_API_SECRET = "test-stop-secret";
    t.after(() => {
      if (originalSecret === undefined) delete process.env.INTERNAL_API_SECRET;
      else process.env.INTERNAL_API_SECRET = originalSecret;
    });
    let stopRequested = false;
    t.mock.method(globalThis, "fetch", async () => {
      stopRequested = true;
      return Response.json({
        sandbox: { id: "sandbox-test", runtime_summary: { status: "stopped" } },
      });
    });
    const tool = createStopSandbox("user-test", "sandbox-test", {
      execute: async (_sandboxId, _headers, body) => {
        const { stdout, stderr } = await exec("sh", ["-c", body.command], {
          cwd,
        });
        return Response.json({ exitCode: 0, stdout, stderr });
      },
    });
    assert.ok(tool.execute);
    const result = await tool.execute(
      { sandboxId: "sandbox-test" },
      { toolCallId: "stop-test", messages: [] }
    );
    assert.equal(stopRequested, shouldStop);
    if (shouldStop) return;
    assert.deepEqual(result, {
      error: `The sandbox has 1 uncommitted change(s): ${changedPath}. Stopping discards them. Commit and push first, or ask the operator whether to discard them and call again with discardChanges: true.`,
      reason: "uncommitted_changes",
      files: [changedPath],
    });
  });
}

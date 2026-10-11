import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Sandbox } from "@vercel/sandbox";
import { executeSandboxCommand } from "../../lib/sandbox/exec-result";

test(
  "Stop reaps detached and orphaned command descendants, preserving unrelated compute and files",
  {
    skip:
      process.platform !== "linux" &&
      "Vercel process ownership uses Linux subreapers; also run this suite in Linux locally",
    timeout: 15_000,
  },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "control-process-tree-"));
    const unrelated = spawn("python3", ["-c", "import signal; signal.pause()"]);
    const ready = Promise.withResolvers<void>();
    const interrupted = () =>
      ready.reject(new Error("Process test interrupted"));
    t.signal.addEventListener("abort", interrupted, { once: true });
    const controller = new AbortController();
    let output = "";
    let errors = "";
    const pids: number[] = [];
    let command: ReturnType<typeof spawn> | undefined;
    const sandbox = {
      runCommand: async (options: {
        cmd: string;
        args: string[];
        cwd: string;
      }) => {
        command = spawn(options.cmd, options.args, { cwd: options.cwd });
        const exited = new Promise<{ exitCode: number }>((resolve, reject) => {
          command!.once("error", (error) => {
            ready.reject(error);
            reject(error);
          });
          command!.once("exit", (code) => {
            ready.reject(
              new Error(`Command exited before readiness: ${code}: ${errors}`)
            );
            resolve({ exitCode: code ?? 143 });
          });
        });
        command.stdout?.on("data", (chunk: Buffer) => {
          output += chunk.toString();
          const matches = [...output.matchAll(/OWNED:(\d+)/g)];
          if (matches.length === 2) {
            pids.splice(
              0,
              pids.length,
              ...matches.map((match) => Number(match[1]))
            );
            ready.resolve();
          }
        });
        command.stderr?.on("data", (chunk: Buffer) => {
          errors += chunk.toString();
        });
        return {
          cmdId: "owned-command",
          exitCode: null,
          wait: () => exited,
          kill: async () => {
            command!.kill("SIGTERM");
          },
          stdout: async () => output,
          stderr: async () => errors,
        };
      },
    } as unknown as Sandbox;
    const running = executeSandboxCommand(sandbox, {
      command: "python3",
      args: [
        "-u",
        "-c",
        `
import os, signal
open("saved-work.txt", "w").write("keep this work")
child = os.fork()
if child == 0:
    os.setsid()
    if os.fork() == 0:
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        print("OWNED:" + str(os.getpid()), flush=True)
        signal.pause()
    os._exit(0)
os.waitpid(child, 0)
print("OWNED:" + str(os.getpid()), flush=True)
signal.pause()
`,
      ],
      cwd: directory,
      env: {},
      signal: controller.signal,
      onStarted: async () => {},
    });
    const cancelled = assert.rejects(running, /abort/i);
    try {
      await ready.promise;
      controller.abort();
      await cancelled;
      for (const pid of pids)
        assert.throws(
          () => process.kill(pid, 0),
          { code: "ESRCH" },
          `Owned process ${pid} survived Stop`
        );
      assert.equal(process.kill(unrelated.pid!, 0), true);
      assert.equal(
        await readFile(join(directory, "saved-work.txt"), "utf8"),
        "keep this work"
      );
    } finally {
      t.signal.removeEventListener("abort", interrupted);
      controller.abort();
      for (const pid of pids) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // Expected after the supervisor has reaped the owned process.
        }
      }
      command?.kill("SIGKILL");
      unrelated.kill("SIGKILL");
      await rm(directory, { recursive: true, force: true });
    }
  }
);

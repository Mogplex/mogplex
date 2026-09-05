import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { TERMINAL_BRIDGE_BOOTSTRAP } from "./terminal-bridge-bootstrap";

const exec = promisify(execFile);

test("launcher returns on listening and leaves the bridge serving after its parent exits", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mogplex-bridge-test-"));
  const script = join(directory, "bridge.mjs");
  const log = join(directory, "bridge.log");
  let pid: number | undefined;
  try {
    await writeFile(
      script,
      `
      import http from 'node:http';
      const server = http.createServer((_req, res) => res.end('ready'));
      server.listen(0, '127.0.0.1', () => {
        console.log(JSON.stringify({pid: process.pid, port: server.address().port}));
        process.send({type: 'listening'});
      });
    `
    );
    const result = await exec(process.execPath, [
      "-e",
      TERMINAL_BRIDGE_BOOTSTRAP,
      script,
      log,
    ]);
    const details = JSON.parse(await readFile(log, "utf8")) as {
      pid: number;
      port: number;
    };
    pid = details.pid;
    expect(result.stdout).toContain("MOGPLEX_TERMINAL_BRIDGE_READY");
    expect(
      await fetch(`http://127.0.0.1:${details.port}`).then((response) =>
        response.text()
      )
    ).toBe("ready");
  } finally {
    if (pid) process.kill(pid);
    await rm(directory, { recursive: true, force: true });
  }
});

test("launcher reports child failure without publishing private child logs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mogplex-bridge-failure-"));
  const script = join(directory, "bridge.mjs");
  const log = join(directory, "bridge.log");
  try {
    await writeFile(
      script,
      "console.error('private-runtime-diagnostic'); process.exit(1);"
    );
    await expect(
      exec(process.execPath, ["-e", TERMINAL_BRIDGE_BOOTSTRAP, script, log])
    ).rejects.toMatchObject({
      code: 1,
      stdout: "Terminal bridge startup failed\n",
      stderr: "",
    });
    expect(await readFile(log, "utf8")).toContain("private-runtime-diagnostic");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

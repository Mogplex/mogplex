import { expect, test } from "@playwright/test";
import { execFile } from "node:child_process";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

test("a freshly installed terminal bridge is ready for the browser when startup returns", async ({
  page,
}) => {
  // Match the real VM's canonical source path; macOS tmpdir is a symlink.
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), "mogplex-bridge-e2e-"))
  );
  const reserve = createServer();
  await new Promise<void>((resolve) => reserve.listen(0, "127.0.0.1", resolve));
  const address = reserve.address();
  if (!address || typeof address === "string")
    throw new Error("Missing test port");
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    reserve.close((error) => (error ? reject(error) : resolve()))
  );
  let pid: number | undefined;
  try {
    const result = await exec(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve("tests/e2e/helpers/terminal-bridge-process.ts"),
        directory,
        String(port),
      ],
      { timeout: 20000 }
    );
    const installation = JSON.parse(result.stdout) as {
      pid: number;
      port: number;
    };
    pid = installation.pid;
    expect(installation.port).toBe(port);
    await page.goto(`http://127.0.0.1:${port}/health`);
    await expect(page.locator("body")).toContainText('"ok":true');
  } finally {
    if (pid) process.kill(pid);
    await rm(directory, { recursive: true, force: true });
  }
});

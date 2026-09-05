// Run through tsx rather than Playwright's CJS transformer: the real bridge
// source loader uses import.meta.url. Only the provider boundary is adapted.
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import {
  installTerminalBridgeOnce,
  TERMINAL_BRIDGE_LOG_PATH,
} from "../../../lib/sandbox/terminal-bridge-install";

const exec = promisify(execFile);
const [directory, portText] = process.argv.slice(2);
const port = Number(portText);
if (!directory || !Number.isInteger(port))
  throw new Error("Missing test arguments");
const mapPath = (path: string) =>
  path
    .replaceAll(TERMINAL_BRIDGE_LOG_PATH, join(directory, "bridge.log"))
    .replaceAll("/vercel/sandbox", directory);

async function main() {
  await installTerminalBridgeOnce(
    {
      name: "local-browser-bridge",
      async writeFiles(files) {
        for (const file of files) {
          const path = mapPath(file.path);
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, file.content);
        }
      },
      async runCommand(input) {
        const result = await exec(input.cmd, input.args.map(mapPath), {
          timeout: 15000,
        });
        return {
          exitCode: 0,
          stdout: async () => result.stdout,
          stderr: async () => result.stderr,
        };
      },
    },
    { port }
  );
  const health = await fetch(`http://127.0.0.1:${port}/health`).then(
    (response) => response.json()
  );
  console.log(JSON.stringify({ pid: health.pid, port }));
}
// eslint-disable-next-line unicorn/prefer-top-level-await -- tsx uses a CommonJS entrypoint for this test helper.
main().catch(() => {
  console.error("Test bridge startup failed");
  process.exitCode = 1;
});

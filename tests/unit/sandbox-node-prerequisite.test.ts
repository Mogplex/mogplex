import assert from "node:assert/strict";
import test from "node:test";
import { ensureNodePrerequisite } from "@/lib/sandbox/node-prerequisite";

for (const scenario of [
  "install",
  "already-compatible",
  "checksum-failure",
  "no-release",
] as const) {
  test(`Node prerequisite: ${scenario}`, async () => {
    const originalFetch = globalThis.fetch;
    const commands: { cmd: string; args: string[] }[] = [];
    globalThis.fetch = async (url) => {
      assert.equal(url, "https://nodejs.org/dist/index.json");
      return Response.json([
        { version: scenario === "no-release" ? "v26.1.0" : "v26.5.0" },
      ]);
    };
    const sandbox = {
      readFileToBuffer: async ({ path }: { path: string }) => {
        if (path === ".nvmrc") return Buffer.from("26.5.0");
        if (path === "package.json")
          return Buffer.from('{"engines":{"node":">=26.5.0 <27"}}');
        return null;
      },
      runCommand: async (command: { cmd: string; args: string[] }) => {
        commands.push(command);
        return {
          exitCode:
            command.cmd === "sh" && scenario === "checksum-failure" ? 1 : 0,
          stdout: async () =>
            command.cmd === "node"
              ? JSON.stringify({
                  version:
                    scenario === "already-compatible" ? "v26.5.0" : "v26.1.0",
                  platform: "linux",
                  arch: "x64",
                  execPath: "/vercel/runtimes/node26/bin/node",
                })
              : "node-v26.5.0-linux-x64.tar.gz: OK\nv26.5.0\n",
          stderr: async () =>
            scenario === "checksum-failure" ? "checksum mismatch" : "",
        };
      },
    };
    try {
      const run = () =>
        ensureNodePrerequisite(
          sandbox as never,
          "node26",
          null,
          "https://preview.example.test"
        );
      if (scenario === "checksum-failure")
        await assert.rejects(run, /Runtime prerequisite failed/);
      else if (scenario === "no-release")
        await assert.rejects(run, /No published Node.js/);
      else await run();
      assert.equal(
        commands.length,
        scenario === "already-compatible" || scenario === "no-release" ? 1 : 2
      );
      if (commands[1]) {
        const script = commands[1].args[1];
        assert.ok(
          script.indexOf("sha256sum -c -") < script.indexOf("sudo install")
        );
        assert.match(
          script,
          /https:\/\/nodejs.org\/dist\/v26\.5\.0\/node-v26\.5\.0-linux-x64\.tar\.gz/
        );
        assert.match(
          script,
          /sudo install -m 755 .* \/vercel\/runtimes\/node26\/bin\/node/
        );
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}

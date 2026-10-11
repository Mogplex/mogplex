import assert from "node:assert/strict";
import { it as test } from "vitest";
import { ensureNodePrerequisite } from "@/lib/sandbox/node-prerequisite";

for (const scenario of [
  "install",
  "already-compatible",
  "checksum-failure",
  "no-release",
  "unexpected-installed-version",
  "release-index-failure",
  "probe-failure",
  "unsupported-arch",
  "unsupported-platform",
  "unexpected-exec-path",
  "undeclared",
  "python",
] as const) {
  test(`Node prerequisite: ${scenario}`, async () => {
    const originalFetch = globalThis.fetch;
    const commands: { cmd: string; args: string[] }[] = [];
    globalThis.fetch = async (url) => {
      assert.equal(url, "https://nodejs.org/dist/index.json");
      if (scenario === "release-index-failure")
        return new Response(null, { status: 503 });
      return Response.json([
        { version: scenario === "no-release" ? "v26.1.0" : "v26.5.0" },
      ]);
    };
    const sandbox = {
      readFileToBuffer: async ({ path }: { path: string }) => {
        if (scenario === "undeclared") return null;
        if (path === ".nvmrc") return Buffer.from("26.5.0");
        if (path === "package.json")
          return Buffer.from('{"engines":{"node":">=26.5.0 <27"}}');
        return null;
      },
      runCommand: async (command: { cmd: string; args: string[] }) => {
        commands.push(command);
        return {
          exitCode:
            (command.cmd === "sh" && scenario === "checksum-failure") ||
            (command.cmd === "node" && scenario === "probe-failure")
              ? 1
              : 0,
          stdout: async () =>
            command.cmd === "node"
              ? JSON.stringify({
                  version:
                    scenario === "already-compatible" ? "v26.5.0" : "v26.1.0",
                  platform:
                    scenario === "unsupported-platform" ? "darwin" : "linux",
                  arch: scenario === "unsupported-arch" ? "ia32" : "x64",
                  execPath:
                    scenario === "unexpected-exec-path"
                      ? "/usr/local/bin/node"
                      : "/vercel/runtimes/node26/bin/node",
                })
              : scenario === "unexpected-installed-version"
                ? "v26.1.0\n"
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
          scenario === "python" ? "python3.13" : "node26",
          null,
          "https://preview.example.test"
        );
      switch (scenario) {
        case "checksum-failure":
        case "unexpected-installed-version": {
          await assert.rejects(run, /Runtime prerequisite failed/);
          break;
        }
        case "no-release": {
          await assert.rejects(run, /No published Node.js/);
          break;
        }
        case "release-index-failure": {
          await assert.rejects(run, /Could not load Node.js releases \(503\)/);
          break;
        }
        case "probe-failure": {
          await assert.rejects(
            run,
            /Could not inspect sandbox Node.js version/
          );
          break;
        }
        default:
          await ([
            "unsupported-arch",
            "unsupported-platform",
            "unexpected-exec-path",
          ].includes(scenario)
            ? assert.rejects(run, /Cannot provision/)
            : run());
      }
      assert.equal(
        commands.length,
        ["python", "undeclared"].includes(scenario)
          ? 0
          : [
                "install",
                "checksum-failure",
                "unexpected-installed-version",
              ].includes(scenario)
            ? 2
            : 1
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

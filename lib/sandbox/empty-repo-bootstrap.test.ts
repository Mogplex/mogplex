import type { Sandbox } from "@vercel/sandbox";
import { describe, expect, it } from "vitest";
import {
  bootstrapFromBaselineSnapshotStreaming,
  bootstrapFromSnapshotStreaming,
  bootstrapSandbox,
  bootstrapSandboxStreaming,
} from "./client-bootstrap";
import { readPackageDevScriptInfo } from "./client-bootstrap-context";
import type { BootstrapSandboxOpts } from "./client-types";
import type { SandboxBootstrapStreamEvent } from "@/lib/sandbox/events";

function fakeSandbox(files: Record<string, string>) {
  const commands: string[] = [];
  const sandbox = {
    readFile: async ({ path }: { path: string }) => (path in files ? {} : null),
    readFileToBuffer: async ({ path }: { path: string }) =>
      path in files ? Buffer.from(files[path]) : null,
    writeFiles: async () => {},
    runCommand: async ({ cmd, args }: { cmd: string; args: string[] }) => {
      commands.push([cmd, ...args].join(" "));
      return {
        exitCode: 0,
        stdout: async () =>
          args[1] === "process.versions.node"
            ? "22.11.0\n"
            : args[1]?.includes("const packages = []")
              ? "[]"
              : "",
        stderr: async () => "",
        async *logs() {},
        wait: async () => ({ exitCode: 0 }),
      };
    },
    domain: (port: number) => `https://preview-${port}.example.test`,
  } as unknown as Sandbox;
  return { sandbox, commands };
}

const ranProjectSetup = (commands: string[]) =>
  commands.some((command) => /\binstall\b|\brun dev\b/.test(command));

async function collect(stream: AsyncGenerator<SandboxBootstrapStreamEvent>) {
  const events: SandboxBootstrapStreamEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

const noPackageJsonWarning = expect.objectContaining({
  type: "warning",
  message: expect.stringContaining("no dev server is running"),
});

async function streamUntilInstall(
  files: Record<string, string>,
  opts: BootstrapSandboxOpts = {}
) {
  const { sandbox, commands } = fakeSandbox(files);
  const events = [];
  for await (const event of bootstrapSandboxStreaming(sandbox, opts)) {
    events.push(event);
    if (event.type === "status" && event.status === "installing") break;
  }
  return { events, commands };
}

describe("bootstrap for a repository without package.json", () => {
  it("should come up ready without install or dev when a Node repo has only a README", async () => {
    const { events, commands } = await streamUntilInstall({
      "README.md": "# test",
    });

    expect(ranProjectSetup(commands)).toBe(false);
    expect(events.at(-1)).toEqual({ type: "status", status: "running" });
    expect(events).toContainEqual(noPackageJsonWarning);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "log",
        data: expect.stringContaining("skipped install and dev server"),
      })
    );
  });

  it("should return a ready result from the blocking bootstrap for a README-only repo", async () => {
    const { sandbox, commands } = fakeSandbox({ "README.md": "# test" });

    const result = await bootstrapSandbox(sandbox);

    expect(ranProjectSetup(commands)).toBe(false);
    expect(result).toMatchObject({
      installCommand: "(none)",
      devCommand: "(none)",
      healthStatus: "running",
      devLog: expect.stringContaining("No package.json found"),
    });
  });

  it("should restart from a snapshot without launching a dev server for a README-only repo", async () => {
    const { sandbox, commands } = fakeSandbox({ "README.md": "# test" });
    const events = await collect(bootstrapFromSnapshotStreaming(sandbox));

    expect(ranProjectSetup(commands)).toBe(false);
    expect(events.at(-1)).toEqual({ type: "status", status: "running" });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "log",
        data: expect.stringContaining("no package.json found"),
      })
    );
  });

  it("should run a configured install command but start no dev server for a README-only repo", async () => {
    const { sandbox, commands } = fakeSandbox({ "README.md": "# test" });

    const result = await bootstrapSandbox(sandbox, {
      installCommand: "npm install --global serve",
    });

    expect(commands.some((command) => command.includes("serve"))).toBe(true);
    expect(commands.some((command) => /\brun dev\b/.test(command))).toBe(false);
    expect(result).toMatchObject({
      installCommand: "npm install --global serve",
      devCommand: "(none)",
      devLog: expect.stringContaining("No package.json found"),
    });
  });

  it("should restore a baseline snapshot without install or dev for a README-only repo", async () => {
    const { sandbox, commands } = fakeSandbox({ "README.md": "# test" });

    const events = await collect(
      bootstrapFromBaselineSnapshotStreaming(sandbox, {
        baseBranch: "main",
        workingBranch: "main",
        createBranch: false,
        expectedLockfileHash: "baseline-hash",
      })
    );

    expect(ranProjectSetup(commands)).toBe(false);
    expect(events.at(-1)).toEqual({ type: "status", status: "running" });
    expect(events).toContainEqual(noPackageJsonWarning);
  });

  it.each([
    [
      "unreadable",
      {
        readFileToBuffer: async () => {
          throw new Error("EIO");
        },
      },
    ],
    ["malformed", { readFileToBuffer: async () => Buffer.from("{ nope") }],
  ])(
    "should treat an %s package.json as present so the npm path still runs",
    async (_label, sandbox) => {
      await expect(
        readPackageDevScriptInfo(sandbox as unknown as Sandbox, null)
      ).resolves.toEqual({
        packageDevScript: null,
        hasDevScript: true,
        hasPackageJson: true,
      });
    }
  );

  it("should still install a Python repo that has no package.json", async () => {
    const { events } = await streamUntilInstall({
      "requirements.txt": "fastapi\n",
    });

    expect(events.at(-1)).toEqual({ type: "status", status: "installing" });
  });

  it("should still install when repo settings give a dev command", async () => {
    const { events } = await streamUntilInstall(
      { "README.md": "# test" },
      { devCommand: "npx serve ." }
    );

    expect(events.at(-1)).toEqual({ type: "status", status: "installing" });
  });
});

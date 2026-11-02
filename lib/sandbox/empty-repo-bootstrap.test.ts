import type { Sandbox } from "@vercel/sandbox";
import { describe, expect, it, vi } from "vitest";
import {
  bootstrapFromBaselineSnapshotStreaming,
  bootstrapFromSnapshotStreaming,
  bootstrapSandbox,
  bootstrapSandboxStreaming,
} from "./client-bootstrap";
import { readPackageDevScriptInfo } from "./client-bootstrap-context";
import { isNodeRuntime } from "./runtimes/types";
import type { BootstrapSandboxOpts } from "./client-types";
import type { SandboxBootstrapStreamEvent } from "@/lib/sandbox/events";

function fakeSandbox(files: Record<string, string>, packages: string[] = []) {
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
              ? JSON.stringify(packages)
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

const noManifestWarning = expect.objectContaining({
  type: "warning",
  message: expect.stringContaining("skipped the default install"),
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

describe("bootstrap for a repository without a project manifest", () => {
  it("should come up ready without install or dev when a Node repo has only a README", async () => {
    const { events, commands } = await streamUntilInstall({
      "README.md": "# test",
    });

    expect(ranProjectSetup(commands)).toBe(false);
    expect(events.at(-1)).toEqual({ type: "status", status: "running" });
    expect(events).toContainEqual(noManifestWarning);
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
      devLog: expect.stringContaining("No project manifest for this runtime"),
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
        data: expect.stringContaining("no project manifest for this runtime"),
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
      devLog: expect.stringContaining("No project manifest for this runtime"),
    });
  });

  it("should not claim the install was skipped when a configured install ran", async () => {
    const { sandbox } = fakeSandbox({ "README.md": "# test" });

    const events = await collect(
      bootstrapSandboxStreaming(sandbox, {
        installCommand: "npm install --global serve",
      })
    );
    const warning = events.find((event) => event.type === "warning");

    expect(warning).toMatchObject({
      message: expect.stringContaining(
        "after your install command no dev server was started"
      ),
    });
    expect(JSON.stringify(warning)).not.toContain(
      "skipped the default install"
    );
  });

  it("should skip the default install but run a configured dev command in the blocking bootstrap", async () => {
    const { sandbox, commands } = fakeSandbox({ "README.md": "# test" });

    // fetch is the preview-health boundary; a 200 lets the boot finish here.
    vi.stubGlobal("fetch", async () => new Response("<html>ok</html>"));
    try {
      const result = await bootstrapSandbox(sandbox, {
        devCommand: "npx serve .",
      });

      expect(result).toMatchObject({
        installCommand: "(none)",
        devCommand: "npx serve .",
        installLog: "",
      });
      expect(commands.some((command) => /\binstall\b/.test(command))).toBe(
        false
      );
      expect(commands.some((command) => command.includes("npx serve ."))).toBe(
        true
      );
    } finally {
      vi.unstubAllGlobals();
    }
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
    // A restore never installs, so it must not claim to have skipped one.
    expect(events).toContainEqual({
      type: "warning",
      message: expect.stringContaining(
        "so the restored workspace has no dev server running"
      ),
    });
  });

  it("should not reinstall on lockfile drift when the baseline repo has no manifest", async () => {
    const { sandbox, commands } = fakeSandbox({ "package-lock.json": "{}" });

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
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        await expect(
          readPackageDevScriptInfo(sandbox as unknown as Sandbox, null)
        ).resolves.toEqual({
          packageDevScript: null,
          hasDevScript: true,
        });
        expect(warn).toHaveBeenCalledWith(
          "[sandbox/bootstrap] could not read package.json dev script:",
          expect.any(String)
        );
      } finally {
        warn.mockRestore();
      }
    }
  );

  it("should finish without the manifest warning when package.json has no dev script", async () => {
    const { sandbox } = fakeSandbox({
      "package.json": JSON.stringify({ scripts: { build: "tsc" } }),
    });

    const events = await collect(bootstrapSandboxStreaming(sandbox));

    expect(events).not.toContainEqual(noManifestWarning);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "log",
        data: expect.stringContaining("No dev script found in package.json"),
      })
    );
    expect(events.at(-1)).toEqual({ type: "status", status: "running" });
  });

  it("should take the npm path for an empty package.json", async () => {
    const { events } = await streamUntilInstall({ "package.json": "" });

    expect(events).not.toContainEqual(noManifestWarning);
    expect(events.at(-1)).toEqual({ type: "status", status: "installing" });
  });

  it("should install a monorepo whose only package.json is in the auto-selected app", async () => {
    const { sandbox } = fakeSandbox(
      {
        "README.md": "# monorepo",
        "apps/web/package.json": JSON.stringify({
          dependencies: { next: "16" },
          scripts: { dev: "next dev" },
        }),
        "apps/web/pnpm-lock.yaml": "lockfileVersion: '9.0'",
      },
      ["apps/web"]
    );
    const events = [];
    for await (const event of bootstrapSandboxStreaming(sandbox)) {
      events.push(event);
      if (event.type === "status" && event.status === "installing") break;
    }

    expect(events).not.toContainEqual(noManifestWarning);
    expect(events.at(-1)).toEqual({ type: "status", status: "installing" });
  });

  it("should still install a Python repo that has no package.json", async () => {
    const { events } = await streamUntilInstall({
      "requirements.txt": "fastapi\n",
    });

    expect(events).not.toContainEqual(noManifestWarning);
    expect(events.at(-1)).toEqual({ type: "status", status: "installing" });
  });

  it.each([
    ["a Go module", { "go.mod": "module example.com/app\n", "main.go": "" }],
    ["a Python-runtime repo with only a README", { "README.md": "# test" }],
  ])("should come up ready without install for %s", async (_, files) => {
    const { sandbox, commands } = fakeSandbox(files);
    const events = await collect(
      bootstrapSandboxStreaming(sandbox, {
        runtime: "README.md" in files ? "python3.13" : undefined,
      })
    );

    expect(commands.some((command) => /\binstall\b/.test(command))).toBe(false);
    expect(events).toContainEqual(noManifestWarning);
    expect(events.at(-1)).toEqual({ type: "status", status: "running" });
  });

  it.each([
    ["node22", "Node.js 22", "Python", { "requirements.txt": "fastapi\n" }],
    [
      "python3.13",
      "Python 3.13",
      "Node.js",
      { "package.json": JSON.stringify({ name: "app" }) },
    ],
  ] as const)(
    "should skip install and name the mismatch when the pinned %s runtime does not use the repo's manifest",
    async (runtime, label, found, files) => {
      const { sandbox, commands } = fakeSandbox(files);
      const result = await bootstrapSandbox(sandbox, { runtime });
      const events = await collect(
        bootstrapSandboxStreaming(fakeSandbox(files).sandbox, { runtime })
      );

      expect(ranProjectSetup(commands)).toBe(false);
      expect(result).toMatchObject({
        runtime,
        installCommand: "(none)",
        devCommand: "(none)",
      });
      expect(events).toContainEqual({
        type: "warning",
        message: expect.stringContaining(
          `The runtime is set to ${label}, but the project is a ${found} project`
        ),
      });
    }
  );

  it("should name the missing manifest rather than a mismatch for a README-only repo", async () => {
    const events = await collect(
      bootstrapSandboxStreaming(fakeSandbox({ "README.md": "# test" }).sandbox)
    );

    expect(events).toContainEqual({
      type: "warning",
      message: expect.stringContaining(
        "No package.json, pyproject.toml or requirements.txt found"
      ),
    });
  });

  it("should start the Python dev server when the repo also carries a package.json without a dev script", async () => {
    const { sandbox, commands } = fakeSandbox({
      "requirements.txt": "fastapi\n",
      "package.json": JSON.stringify({ scripts: { lint: "eslint ." } }),
    });
    for await (const event of bootstrapSandboxStreaming(sandbox, {
      runtime: "python3.13",
    })) {
      if (event.type === "preview_url") break;
    }

    expect(commands.some((command) => command.includes("uvicorn"))).toBe(true);
  });

  it("should skip the default install but launch a configured dev command for a README-only repo", async () => {
    const { sandbox, commands } = fakeSandbox({ "README.md": "# test" });
    const events = [];
    const stream = bootstrapSandboxStreaming(sandbox, {
      devCommand: "npx serve .",
    });
    for await (const event of stream) {
      events.push(event);
      if (event.type === "preview_url") break;
    }

    expect(commands.some((command) => /\binstall\b/.test(command))).toBe(false);
    expect(commands.some((command) => command.includes("npx serve ."))).toBe(
      true
    );
    expect(events.at(-1)).toMatchObject({ type: "preview_url" });
  });

  it("should launch a configured dev command when package.json has no dev script", async () => {
    const { sandbox, commands } = fakeSandbox({
      "package.json": JSON.stringify({ scripts: { build: "tsc" } }),
    });
    const stream = bootstrapSandboxStreaming(sandbox, {
      devCommand: "npx serve dist",
    });
    for await (const event of stream) {
      if (event.type === "preview_url") break;
    }

    expect(commands.some((command) => command.includes("npx serve dist"))).toBe(
      true
    );
  });

  it("should only treat Node runtimes as Node", () => {
    expect(isNodeRuntime("node24")).toBe(true);
    expect(isNodeRuntime("python3.13")).toBe(false);
  });
});

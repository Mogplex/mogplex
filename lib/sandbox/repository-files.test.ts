import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Sandbox } from "@vercel/sandbox";
import { expect, it } from "vitest";
import { sandboxRepositoryFiles } from "./repository-files";
import { detectRepositoryDevPort } from "./dev-port";

it("discovers a nonstandard workspace through the actual directory probe", async () => {
  const root = await mkdtemp(join(tmpdir(), "mogplex-port-"));
  try {
    await mkdir(join(root, "services", "customer app"), { recursive: true });
    await mkdir(join(root, "node_modules"));
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ workspaces: ["services/*"] })
    );
    await writeFile(
      join(root, "services", "customer app", "package.json"),
      JSON.stringify({
        dependencies: { vite: "7" },
        scripts: { dev: "vite --port 4777" },
      })
    );
    const sandbox = {
      readFileToBuffer: async ({ path }: { path: string }) => {
        try {
          return await readFile(join(root, path));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
          throw error;
        }
      },
      runCommand: async ({ cmd, args }: { cmd: string; args: string[] }) => {
        expect(cmd).toBe("node");
        const result = await promisify(execFile)(process.execPath, args, {
          cwd: root,
        });
        return { exitCode: 0, stdout: async () => result.stdout };
      },
    } as unknown as Sandbox;
    const files = sandboxRepositoryFiles(sandbox);
    expect(await files.listDirectories("services")).toEqual(["customer app"]);
    expect(await files.listDirectories("absent")).toEqual([]);
    expect(await detectRepositoryDevPort(files, {})).toBe(4777);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("reports directory-probe failures rather than returning an unrelated default", async () => {
  const sandbox = {
    runCommand: async () => ({ exitCode: 1, stdout: async () => "" }),
  } as unknown as Sandbox;
  await expect(
    sandboxRepositoryFiles(sandbox).listDirectories("apps")
  ).rejects.toThrow("Could not inspect workspace directories");
});

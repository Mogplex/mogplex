import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Sandbox } from "@vercel/sandbox";
import { afterEach, expect, it, vi } from "vitest";
import {
  githubRepositoryFiles,
  sandboxRepositoryFiles,
} from "./repository-files";
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
    expect(await files.listPackageDirectories!()).toEqual([
      "",
      "services/customer app",
    ]);
    expect(await detectRepositoryDevPort(files, {})).toBe(4777);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

afterEach(() => vi.restoreAllMocks());

it("indexes GitHub package paths in one request at the requested ref", async () => {
  const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({
      truncated: false,
      tree: [
        { type: "blob", path: "package.json" },
        { type: "blob", path: "custom/deep/web/package.json" },
        { type: "blob", path: "README.md" },
        { type: "tree", path: "directory/package.json" },
        null,
      ],
    })
  );
  const files = githubRepositoryFiles({
    repoFullName: "acme/repo",
    githubToken: "fixture",
    ref: "feature/nested app",
  });
  expect(await files.listPackageDirectories!()).toEqual([
    "",
    "custom/deep/web",
  ]);
  expect(request).toHaveBeenCalledTimes(1);
  expect(String(request.mock.calls[0][0])).toContain(
    "/git/trees/feature%2Fnested%20app?recursive=1"
  );
});

it.each([404, 200])(
  "falls back when the tree is unavailable or truncated (%s)",
  async (status) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ truncated: true, tree: [] }, { status })
    );
    const files = githubRepositoryFiles({
      repoFullName: "acme/repo",
      githubToken: "fixture",
      ref: "main",
    });
    expect(await files.listPackageDirectories!()).toBeNull();
  }
);

it("reports GitHub index access and invalid-response failures", async () => {
  const request = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response("", { status: 403 }));
  const files = githubRepositoryFiles({
    repoFullName: "acme/repo",
    githubToken: "fixture",
    ref: "main",
  });
  await expect(files.listPackageDirectories!()).rejects.toThrow("GitHub 403");
  request.mockResolvedValue(Response.json({}));
  await expect(files.listPackageDirectories!()).rejects.toThrow(
    "Invalid repository package index"
  );
});

it("reports directory-probe failures rather than returning an unrelated default", async () => {
  const sandbox = {
    runCommand: async () => ({ exitCode: 1, stdout: async () => "" }),
  } as unknown as Sandbox;
  await expect(
    sandboxRepositoryFiles(sandbox).listDirectories("apps")
  ).rejects.toThrow("Could not inspect workspace directories");
});

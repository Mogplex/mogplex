import type { Sandbox } from "@vercel/sandbox";

/** Read repository files without executing repository code. Paths are repo-relative. */
export type RepositoryFiles = {
  /** Missing files return null; authentication, transport and I/O failures throw. */
  readText: (path: string) => Promise<string | null>;
  listDirectories: (path: string) => Promise<string[]>;
  /** Complete package-directory index, or null when the provider truncates it. */
  listPackageDirectories?: () => Promise<string[] | null>;
};

export const DISCOVERY_IGNORED_DIRECTORIES = [
  "node_modules",
  "dist",
  "build",
  "coverage",
  "vendor",
  "venv",
  "__pycache__",
];

export function sandboxRepositoryFiles(sandbox: Sandbox): RepositoryFiles {
  return {
    readText: async (path) =>
      (await sandbox.readFileToBuffer({ path }))?.toString("utf8") ?? null,
    listDirectories: async (path) => {
      const command = await sandbox.runCommand({
        cmd: "node",
        args: [
          "-e",
          "const fs=require('node:fs');try{console.log(JSON.stringify(fs.readdirSync(process.argv[1]||'.',{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>e.name)))}catch(e){if(e.code==='ENOENT')console.log('[]');else throw e}",
          path || ".",
        ],
      });
      if (command.exitCode !== 0)
        throw new Error("Could not inspect workspace directories");
      const names: unknown = JSON.parse(await command.stdout());
      return Array.isArray(names)
        ? names.filter((name): name is string => typeof name === "string")
        : [];
    },
    listPackageDirectories: async () => {
      // One filesystem walk, rather than one remote command per directory.
      const command = await sandbox.runCommand({
        cmd: "node",
        args: [
          "-e",
          `
          const fs = require('node:fs');
          const ignored = new Set(${JSON.stringify(DISCOVERY_IGNORED_DIRECTORIES)});
          const packages = [];
          function visit(directory) {
            for (const entry of fs.readdirSync(directory || '.', { withFileTypes: true })) {
              const path = directory ? directory + '/' + entry.name : entry.name;
              if (entry.isFile() && entry.name === 'package.json') packages.push(directory);
              if (entry.isDirectory() && !entry.name.startsWith('.') && !ignored.has(entry.name)) visit(path);
            }
          }
          visit('');
          console.log(JSON.stringify(packages));
        `,
        ],
      });
      if (command.exitCode !== 0)
        throw new Error("Could not inspect repository packages");
      return readPackageDirectories(JSON.parse(await command.stdout()));
    },
  };
}

function readPackageDirectories(value: unknown): string[] {
  if (!Array.isArray(value))
    throw new Error("Invalid repository package index");
  return value.filter((path): path is string => typeof path === "string");
}

export function githubRepositoryFiles(input: {
  repoFullName: string;
  githubToken: string;
  ref: string;
}): RepositoryFiles {
  const cache = new Map<string, Promise<Response>>();
  // All discovery paths share these slots, including monorepo auto-selection.
  // Transfer a slot directly to the next read; no polling or workspace limit.
  let activeReads = 0;
  const waitingReads: Array<() => void> = [];
  const readWithSlot = async (read: () => Promise<Response>) => {
    await new Promise<void>((resolve) => {
      if (activeReads < 4) {
        activeReads += 1;
        resolve();
      } else {
        waitingReads.push(resolve);
      }
    });
    try {
      return await read();
    } finally {
      const resumeRead = waitingReads.shift();
      if (resumeRead) resumeRead();
      else activeReads -= 1;
    }
  };
  const get = async (path: string, raw: boolean) => {
    const key = `${raw}:${path}`;
    let pending = cache.get(key);
    if (!pending) {
      const encoded = path.split("/").map(encodeURIComponent).join("/");
      const url = `https://api.github.com/repos/${input.repoFullName}/contents/${encoded}?ref=${encodeURIComponent(input.ref)}`;
      pending = readWithSlot(() =>
        fetch(url, {
          headers: {
            Authorization: `Bearer ${input.githubToken}`,
            Accept: raw
              ? "application/vnd.github.raw+json"
              : "application/vnd.github+json",
          },
          signal: AbortSignal.timeout(15_000),
        })
      );
      cache.set(key, pending);
    }
    const response = (await pending).clone();
    if (response.status === 404) return null;
    if (!response.ok)
      throw new Error(
        `Could not inspect repository files (GitHub ${response.status})`
      );
    return response;
  };
  return {
    readText: async (path) => (await get(path, true))?.text() ?? null,
    listDirectories: async (path) => {
      const response = await get(path, false);
      if (!response) return [];
      const entries: unknown = await response.json();
      if (!Array.isArray(entries)) return [];
      return entries.flatMap((entry: unknown) => {
        if (!entry || typeof entry !== "object") return [];
        const value = entry as { type?: unknown; name?: unknown };
        return value.type === "dir" && typeof value.name === "string"
          ? [value.name]
          : [];
      });
    },
    listPackageDirectories: async () => {
      const response = await readWithSlot(() =>
        fetch(
          `https://api.github.com/repos/${input.repoFullName}/git/trees/${encodeURIComponent(input.ref)}?recursive=1`,
          {
            headers: {
              Authorization: `Bearer ${input.githubToken}`,
              Accept: "application/vnd.github+json",
            },
            signal: AbortSignal.timeout(15_000),
          }
        )
      );
      if (response.status === 404) return null;
      if (!response.ok)
        throw new Error(
          `Could not inspect repository files (GitHub ${response.status})`
        );
      const data: unknown = await response.json();
      if (!data || typeof data !== "object")
        throw new Error("Invalid repository package index");
      // Never treat an incomplete tree as a complete list of possible apps.
      if ("truncated" in data && data.truncated === true) return null;
      if (!("tree" in data) || !Array.isArray(data.tree))
        throw new Error("Invalid repository package index");
      return data.tree.flatMap((entry) => {
        if (
          !entry ||
          typeof entry !== "object" ||
          entry.type !== "blob" ||
          typeof entry.path !== "string"
        )
          return [];
        if (entry.path === "package.json") return [""];
        return entry.path.endsWith("/package.json")
          ? [entry.path.slice(0, -13)]
          : [];
      });
    },
  };
}

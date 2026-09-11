import type { Sandbox } from "@vercel/sandbox";

/** Read repository files without executing repository code. Paths are repo-relative. */
export type RepositoryFiles = {
  readText: (path: string) => Promise<string | null>;
  listDirectories: (path: string) => Promise<string[]>;
};

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
  };
}

export function githubRepositoryFiles(input: {
  repoFullName: string;
  githubToken: string;
  ref: string;
}): RepositoryFiles {
  const cache = new Map<string, Promise<Response>>();
  const get = async (path: string, raw: boolean) => {
    const key = `${raw}:${path}`;
    let pending = cache.get(key);
    if (!pending) {
      const encoded = path.split("/").map(encodeURIComponent).join("/");
      const url = `https://api.github.com/repos/${input.repoFullName}/contents/${encoded}?ref=${encodeURIComponent(input.ref)}`;
      pending = fetch(url, {
        headers: {
          Authorization: `Bearer ${input.githubToken}`,
          Accept: raw
            ? "application/vnd.github.raw+json"
            : "application/vnd.github+json",
        },
        signal: AbortSignal.timeout(15_000),
      });
      cache.set(key, pending);
    }
    const response = (await pending).clone();
    if (response.status === 404) return null;
    if (!response.ok)
      throw new Error(
        `Could not inspect repository dev port (GitHub ${response.status})`
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
  };
}

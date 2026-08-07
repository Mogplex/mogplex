import { z } from "zod";
import {
  defineTool,
  encodeGitHubPath,
  resolveRepoTarget,
  type RepoToolDefaults,
} from "./shared";

const readFileParams = z.object({
  path: z.string().describe("File path relative to repo root"),
  owner: z
    .string()
    .optional()
    .describe("GitHub owner. Optional when an active repository is selected."),
  repo: z
    .string()
    .optional()
    .describe(
      "GitHub repo name. Optional when an active repository is selected."
    ),
  branch: z
    .string()
    .optional()
    .describe("Branch name. Optional when an active repository is selected."),
});

export function createReadFile(
  githubToken?: string | null,
  repoDefaults?: RepoToolDefaults
) {
  return defineTool({
    description: "Read a file from the repository",
    inputSchema: readFileParams,
    execute: async ({
      path,
      owner,
      repo,
      branch,
    }: z.infer<typeof readFileParams>) => {
      let normalizedPath = path.trim().replace(/^\/+/, "").replace(/\/+$/, "");
      if (!normalizedPath) {
        return {
          error:
            "Missing file path. Use list_files first to inspect directories, then read a specific file.",
        };
      }

      // Prepend rootDirectory so agents don't need to know the monorepo prefix
      if (
        repoDefaults?.rootDirectory &&
        !normalizedPath.startsWith(`${repoDefaults.rootDirectory}/`) &&
        normalizedPath !== repoDefaults.rootDirectory
      ) {
        normalizedPath = `${repoDefaults.rootDirectory}/${normalizedPath}`;
      }

      const target = resolveRepoTarget({ owner, repo, branch }, repoDefaults);
      if ("error" in target) return target;

      const url = `https://api.github.com/repos/${target.owner}/${target.repo}/contents/${encodeGitHubPath(normalizedPath)}?ref=${target.branch}`;
      const headers: Record<string, string> = {
        Accept: "application/vnd.github.v3.raw",
      };
      if (githubToken) headers.Authorization = `Bearer ${githubToken}`;
      const res = await fetch(url, { headers });
      if (!res.ok) return { error: `HTTP ${res.status}` };
      const content = await res.text();
      return { path: normalizedPath, content: content.slice(0, 10000) };
    },
  });
}

const listFilesParams = z.object({
  path: z.string().default("").describe("Directory path"),
  owner: z
    .string()
    .optional()
    .describe("GitHub owner. Optional when an active repository is selected."),
  repo: z
    .string()
    .optional()
    .describe(
      "GitHub repo name. Optional when an active repository is selected."
    ),
  branch: z
    .string()
    .optional()
    .describe("Branch name. Optional when an active repository is selected."),
});

export function createListFiles(
  githubToken?: string | null,
  repoDefaults?: RepoToolDefaults
) {
  return defineTool({
    description: "List files in a repository directory",
    inputSchema: listFilesParams,
    execute: async ({
      path,
      owner,
      repo,
      branch,
    }: z.infer<typeof listFilesParams>) => {
      const target = resolveRepoTarget({ owner, repo, branch }, repoDefaults);
      if ("error" in target) return target;

      let normalizedPath = path.trim().replace(/^\/+/, "").replace(/\/+$/, "");
      // Prepend rootDirectory so agents don't need to know the monorepo prefix
      if (
        repoDefaults?.rootDirectory &&
        !normalizedPath.startsWith(`${repoDefaults.rootDirectory}/`) &&
        normalizedPath !== repoDefaults.rootDirectory
      ) {
        normalizedPath = normalizedPath
          ? `${repoDefaults.rootDirectory}/${normalizedPath}`
          : repoDefaults.rootDirectory;
      }
      const contentsPath = normalizedPath
        ? `/${encodeGitHubPath(normalizedPath)}`
        : "";
      const url = `https://api.github.com/repos/${target.owner}/${target.repo}/contents${contentsPath}?ref=${target.branch}`;
      const headers: Record<string, string> = {
        Accept: "application/vnd.github.v3+json",
      };
      if (githubToken) headers.Authorization = `Bearer ${githubToken}`;
      const res = await fetch(url, { headers });
      if (!res.ok) return { error: `HTTP ${res.status}` };
      const items = await res.json();
      return {
        path: normalizedPath,
        files: (items as { name: string; type: string; size: number }[]).map(
          (i) => ({
            name: i.name,
            type: i.type,
            size: i.size,
          })
        ),
      };
    },
  });
}

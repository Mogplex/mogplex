import { tool } from "ai";
import { z } from "zod";
import {
  encodeGitHubContentPath,
  GITHUB_FILE_CONTENT_CHAR_LIMIT,
  prepareGitHubTextFile,
  type GitHubFileContent,
} from "@/lib/agents/github-file-content";

export function buildRefactorTools(config: {
  skillId: string;
  githubToken: string;
  owner: string;
  repo: string;
  branch: string;
}) {
  return {
    fetchSkill: tool({
      description: "Fetch skill definition from skills.sh",
      inputSchema: z.object({ skillId: z.string() }),
      execute: async ({ skillId }) => {
        const baseUrl =
          process.env.NEXT_PUBLIC_APP_URL ||
          (process.env.VERCEL_URL
            ? `https://${process.env.VERCEL_URL}`
            : "http://localhost:3000");
        const res = await fetch(`${baseUrl}/api/skills/registry/${skillId}`);
        if (!res.ok)
          throw new Error(`Skills registry ${res.status}: ${await res.text()}`);
        return res.json();
      },
    }),
    listFiles: tool({
      description: "List files in a directory",
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }) => {
        const res = await fetch(
          `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${encodeGitHubContentPath(path)}?ref=${config.branch}`,
          { headers: { Authorization: `Bearer ${config.githubToken}` } }
        );
        if (!res.ok)
          throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
        return res.json();
      },
    }),
    readFile: tool({
      description: "Read file content",
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }) => {
        const res = await fetch(
          `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${encodeGitHubContentPath(path)}?ref=${config.branch}`,
          { headers: { Authorization: `Bearer ${config.githubToken}` } }
        );
        if (!res.ok)
          throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
        // Validate but never truncate: this content feeds whole-file
        // updateFile writes, and a truncated read written back would destroy
        // the file's tail. Oversized files are refused instead.
        const prepared = prepareGitHubTextFile(
          (await res.json()) as GitHubFileContent | GitHubFileContent[],
          path
        );
        if (prepared.kind === "message") return prepared.content;
        if (prepared.content.length > GITHUB_FILE_CONTENT_CHAR_LIMIT) {
          return `File content omitted: ${path} is ${prepared.content.length} characters, above the ${GITHUB_FILE_CONTENT_CHAR_LIMIT}-character limit for safe automated refactoring. Pick a smaller file.`;
        }
        return prepared.content;
      },
    }),
    getBranchHead: tool({
      description: "Get the latest commit SHA for a branch",
      inputSchema: z.object({ branch: z.string() }),
      execute: async ({ branch }) => {
        const res = await fetch(
          `https://api.github.com/repos/${config.owner}/${config.repo}/git/ref/heads/${branch}`,
          {
            headers: {
              Authorization: `Bearer ${config.githubToken}`,
            },
          }
        );
        if (!res.ok)
          throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
        const data = await res.json();
        return { sha: data.object?.sha as string | undefined, branch };
      },
    }),
    createBranch: tool({
      description: "Create a new branch",
      inputSchema: z.object({ name: z.string(), fromSha: z.string() }),
      execute: async ({ name, fromSha }) => {
        const res = await fetch(
          `https://api.github.com/repos/${config.owner}/${config.repo}/git/refs`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${config.githubToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ ref: `refs/heads/${name}`, sha: fromSha }),
          }
        );
        if (!res.ok)
          return { success: false, error: `GitHub API ${res.status}` };
        return { branch: name };
      },
    }),
    updateFile: tool({
      description: "Update a file in the repo",
      inputSchema: z.object({
        path: z.string(),
        content: z.string(),
        message: z.string(),
        branch: z.string(),
        sha: z.string(),
      }),
      execute: async ({ path, content, message, branch, sha }) => {
        const res = await fetch(
          `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${encodeGitHubContentPath(path)}`,
          {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${config.githubToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              message,
              content: Buffer.from(content).toString("base64"),
              branch,
              sha,
            }),
          }
        );
        if (!res.ok)
          return { success: false, error: `GitHub API ${res.status}` };
        return { success: true };
      },
    }),
    createPR: tool({
      description: "Create a pull request",
      inputSchema: z.object({
        title: z.string(),
        body: z.string(),
        head: z.string(),
        base: z.string(),
      }),
      execute: async ({ title, body, head, base }) => {
        const res = await fetch(
          `https://api.github.com/repos/${config.owner}/${config.repo}/pulls`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${config.githubToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ title, body, head, base }),
          }
        );
        if (!res.ok)
          return { success: false, error: `GitHub API ${res.status}` };
        return res.json();
      },
    }),
  };
}

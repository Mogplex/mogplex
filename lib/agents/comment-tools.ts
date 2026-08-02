import { tool } from "ai";
import { z } from "zod";
import { withAutomationMarker } from "@/lib/github-automation-marker";
import {
  createTextContextBudget,
  encodeGitHubContentPath,
  GITHUB_TEXT_CONTEXT_CHAR_LIMIT,
  readBoundedGitHubTextFile,
  type GitHubFileContent,
} from "@/lib/agents/github-file-content";

export function buildCommentTools(config: {
  githubToken: string;
  owner: string;
  repo: string;
  issueNumber: number;
}) {
  const headers = {
    Authorization: `Bearer ${config.githubToken}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
  };
  const textBudget = createTextContextBudget(GITHUB_TEXT_CONTEXT_CHAR_LIMIT);

  return {
    getThreadContext: tool({
      description: "Fetch the issue/PR body and all comments in the thread",
      inputSchema: z.object({}),
      execute: async () => {
        const [issueRes, commentsRes] = await Promise.all([
          fetch(
            `https://api.github.com/repos/${config.owner}/${config.repo}/issues/${config.issueNumber}`,
            { headers }
          ),
          fetch(
            `https://api.github.com/repos/${config.owner}/${config.repo}/issues/${config.issueNumber}/comments?per_page=100`,
            { headers }
          ),
        ]);

        if (!issueRes.ok) throw new Error(`GitHub API ${issueRes.status}`);

        const issue = await issueRes.json();
        const comments = commentsRes.ok ? await commentsRes.json() : [];

        return {
          title: issue.title,
          body: issue.body?.slice(0, 4096) ?? null,
          state: issue.state,
          labels: issue.labels?.map((l: { name: string }) => l.name) ?? [],
          author: issue.user?.login,
          is_pr: Boolean(issue.pull_request),
          comments: (
            comments as {
              id: number;
              user: { login: string };
              body: string;
              created_at: string;
            }[]
          ).map((c) => ({
            id: c.id,
            author: c.user?.login,
            body: c.body?.slice(0, 2048),
            created_at: c.created_at,
          })),
        };
      },
    }),

    replyToThread: tool({
      description: "Post a comment reply on the issue or PR",
      inputSchema: z.object({
        body: z.string().describe("Markdown comment body"),
      }),
      execute: async ({ body }) => {
        const res = await fetch(
          `https://api.github.com/repos/${config.owner}/${config.repo}/issues/${config.issueNumber}/comments`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({ body: withAutomationMarker(body) }),
          }
        );
        if (!res.ok)
          return { success: false, error: `GitHub API ${res.status}` };
        return { success: true };
      },
    }),

    fetchFile: tool({
      description: "Fetch file content from the repository",
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }) => {
        const res = await fetch(
          `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${encodeGitHubContentPath(path)}`,
          { headers }
        );
        if (!res.ok) throw new Error(`GitHub API ${res.status}: ${path}`);
        return readBoundedGitHubTextFile(
          textBudget,
          (await res.json()) as GitHubFileContent | GitHubFileContent[],
          path
        );
      },
    }),

    listFiles: tool({
      description: "List directory contents in the repository",
      inputSchema: z.object({
        path: z.string().default("").describe("Directory path, empty for root"),
      }),
      execute: async ({ path }) => {
        const res = await fetch(
          `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${encodeGitHubContentPath(path)}`,
          { headers }
        );
        if (!res.ok) throw new Error(`GitHub API ${res.status}: ${path}`);
        const data = await res.json();
        if (!Array.isArray(data)) return [{ name: data.name, type: data.type }];
        return (data as { name: string; type: string }[]).map((f) => ({
          name: f.name,
          type: f.type,
        }));
      },
    }),

    addLabels: tool({
      description: "Add labels to the issue or PR",
      inputSchema: z.object({ labels: z.array(z.string()) }),
      execute: async ({ labels }) => {
        const res = await fetch(
          `https://api.github.com/repos/${config.owner}/${config.repo}/issues/${config.issueNumber}/labels`,
          { method: "POST", headers, body: JSON.stringify({ labels }) }
        );
        if (!res.ok)
          return { success: false, error: `GitHub API ${res.status}` };
        return { success: true };
      },
    }),
  };
}

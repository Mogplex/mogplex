import { tool } from "ai";
import { z } from "zod";
import { withAutomationMarker } from "@/lib/github-automation-marker";

export function buildIssueTools(config: {
  githubToken: string;
  owner: string;
  repo: string;
  issueNumber: number;
}) {
  const headers = {
    Authorization: `Bearer ${config.githubToken}`,
    "Content-Type": "application/json",
  };

  return {
    fetchIssue: tool({
      description:
        "Fetch the full issue details including body and existing labels",
      inputSchema: z.object({}),
      execute: async () => {
        const res = await fetch(
          `https://api.github.com/repos/${config.owner}/${config.repo}/issues/${config.issueNumber}`,
          { headers }
        );
        if (!res.ok) throw new Error(`GitHub API ${res.status}`);
        const data = await res.json();
        return {
          title: data.title,
          body: data.body,
          labels: data.labels.map((l: { name: string }) => l.name),
          state: data.state,
          user: data.user?.login,
        };
      },
    }),
    addLabels: tool({
      description: "Add labels to the issue",
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
    postIssueComment: tool({
      description: "Post a comment on the issue",
      inputSchema: z.object({ body: z.string() }),
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
  };
}

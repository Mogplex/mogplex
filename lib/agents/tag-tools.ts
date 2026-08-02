import { tool } from "ai";
import { z } from "zod";
import { withAutomationMarker } from "@/lib/github-automation-marker";
import {
  createTextContextBudget,
  encodeGitHubContentPath,
  GITHUB_FILE_CONTENT_CHAR_LIMIT,
  GITHUB_TEXT_CONTEXT_CHAR_LIMIT,
  prepareGitHubTextFile,
  type GitHubFileContent,
} from "@/lib/agents/github-file-content";

// Toolset for tag_push automation runs. Tags have no PR/issue thread, so file
// reads default to the pushed tag ref (not the repository default branch,
// which may have advanced past the tagged commit) and findings are reported
// as a comment on the tagged commit or as a new issue.
export function buildTagPushTools(config: {
  githubToken: string;
  owner: string;
  repo: string;
  tagName: string;
}) {
  const headers = {
    Authorization: `Bearer ${config.githubToken}`,
    "Content-Type": "application/json",
  };
  // Same per-run validation and text budget as the PR review toolset, so a
  // directory/binary/oversized response cannot break or flood the run.
  const textBudget = createTextContextBudget(GITHUB_TEXT_CONTEXT_CHAR_LIMIT);

  // The push payload's `after` SHA is the tag object for annotated tags, not
  // a commit, so commit comments cannot rely on it. The commits endpoint
  // accepts a tag name as the ref and returns the commit it points at.
  const resolveTagCommitSha = async () => {
    const res = await fetch(
      `https://api.github.com/repos/${config.owner}/${config.repo}/commits/${encodeURIComponent(config.tagName)}`,
      { headers }
    );
    if (!res.ok) {
      throw new Error(
        `GitHub API ${res.status}: resolve tag ${config.tagName}`
      );
    }
    const data = (await res.json()) as { sha: string };
    return data.sha;
  };

  return {
    listFiles: tool({
      description:
        "List directory contents in the repository at the pushed tag (pass ref to override)",
      inputSchema: z.object({
        path: z.string().default("").describe("Directory path, empty for root"),
        ref: z
          .string()
          .optional()
          .describe("Git ref; defaults to the pushed tag"),
      }),
      execute: async ({ path, ref }) => {
        const url = new URL(
          `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${encodeGitHubContentPath(path)}`
        );
        url.searchParams.set("ref", ref || config.tagName);
        const res = await fetch(url.toString(), { headers });
        if (!res.ok) throw new Error(`GitHub API ${res.status}: ${path}`);
        const data = await res.json();
        if (!Array.isArray(data)) return [{ name: data.name, type: data.type }];
        return (data as { name: string; type: string }[]).map((f) => ({
          name: f.name,
          type: f.type,
        }));
      },
    }),

    fetchFile: tool({
      description:
        "Fetch file content from the repository at the pushed tag (pass ref to override)",
      inputSchema: z.object({
        path: z.string(),
        ref: z
          .string()
          .optional()
          .describe("Git ref; defaults to the pushed tag"),
      }),
      execute: async ({ path, ref }) => {
        const url = new URL(
          `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${encodeGitHubContentPath(path)}`
        );
        url.searchParams.set("ref", ref || config.tagName);
        const res = await fetch(url.toString(), { headers });
        if (!res.ok) throw new Error(`GitHub API ${res.status}: ${path}`);
        const prepared = prepareGitHubTextFile(
          (await res.json()) as GitHubFileContent | GitHubFileContent[],
          path
        );
        if (prepared.kind === "message") return prepared.content;

        const bounded = textBudget.consume(
          prepared.content,
          GITHUB_FILE_CONTENT_CHAR_LIMIT
        );
        if (bounded.exhausted) {
          return `File content omitted: the ${GITHUB_TEXT_CONTEXT_CHAR_LIMIT}-character text-context budget is exhausted.`;
        }
        if (!bounded.truncated) return bounded.content;

        return `${bounded.content}\n\n[Truncated ${path}: returned ${bounded.content.length} of ${bounded.originalLength} characters. The text-context budget is ${GITHUB_TEXT_CONTEXT_CHAR_LIMIT} characters.]`;
      },
    }),

    postCommitComment: tool({
      description:
        "Post your findings as a comment on the tagged commit (resolves the tag to its commit automatically)",
      inputSchema: z.object({
        body: z.string(),
        sha: z
          .string()
          .optional()
          .describe(
            "Commit SHA; defaults to the commit the pushed tag points at"
          ),
      }),
      execute: async ({ body, sha }) => {
        const commitSha = sha || (await resolveTagCommitSha());
        const res = await fetch(
          `https://api.github.com/repos/${config.owner}/${config.repo}/commits/${commitSha}/comments`,
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

    createIssue: tool({
      description:
        "Create a new issue when the tagged state needs follow-up work",
      inputSchema: z.object({
        title: z.string(),
        body: z.string(),
        labels: z.array(z.string()).optional(),
      }),
      execute: async ({ title, body, labels }) => {
        const res = await fetch(
          `https://api.github.com/repos/${config.owner}/${config.repo}/issues`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              title,
              body: withAutomationMarker(body),
              labels: labels ?? [],
            }),
          }
        );
        if (!res.ok)
          return { success: false, error: `GitHub API ${res.status}` };
        const data = await res.json();
        return { success: true, issue_number: data.number, url: data.html_url };
      },
    }),
  };
}

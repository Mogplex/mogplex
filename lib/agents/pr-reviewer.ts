import { tool } from "ai";
import { z } from "zod";
import { withAutomationMarker } from "@/lib/github-automation-marker";
import {
  createTextContextBudget,
  encodeGitHubContentPath,
  GITHUB_FILE_CONTENT_CHAR_LIMIT,
  GITHUB_TEXT_CONTEXT_CHAR_LIMIT,
  prepareGitHubTextFile,
  type BoundedText,
  type GitHubFileContent,
} from "@/lib/agents/github-file-content";

const PR_REVIEW_FILE_CONTENT_CHAR_LIMIT = GITHUB_FILE_CONTENT_CHAR_LIMIT;
const PR_REVIEW_PATCH_CHAR_LIMIT = 4_000;
const PR_REVIEW_PATCH_CONTEXT_CHAR_LIMIT = 40_000;
const PR_REVIEW_TEXT_CONTEXT_CHAR_LIMIT = GITHUB_TEXT_CONTEXT_CHAR_LIMIT;

const encodePath = encodeGitHubContentPath;

function githubHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
  };
}

export function buildPRReviewTools(config: {
  fetch?: typeof fetch;
  githubToken: string;
  owner: string;
  repo: string;
  headOwner?: string;
  headRepo?: string;
  prNumber: number;
  defaultRef?: string;
  allowPostComment?: boolean;
}) {
  const request = config.fetch ?? fetch;
  const contentOwner = config.headOwner ?? config.owner;
  const contentRepo = config.headRepo ?? config.repo;
  let returnedPatchContextCharacters = 0;
  const textBudget = createTextContextBudget(PR_REVIEW_TEXT_CONTEXT_CHAR_LIMIT);
  const consumeTextContext = (
    content: string,
    perItemLimit: number
  ): BoundedText => textBudget.consume(content, perItemLimit);
  const boundPatch = (path: string, patch?: string) => {
    if (!patch) return null;

    const remainingPatchContextCharacters = Math.max(
      PR_REVIEW_PATCH_CONTEXT_CHAR_LIMIT - returnedPatchContextCharacters,
      0
    );
    if (remainingPatchContextCharacters === 0) {
      return `[Patch omitted for ${path}: the ${PR_REVIEW_PATCH_CONTEXT_CHAR_LIMIT}-character patch allocation is exhausted; remaining PR review text context is reserved for file reads.]`;
    }

    const bounded = consumeTextContext(
      patch,
      Math.min(PR_REVIEW_PATCH_CHAR_LIMIT, remainingPatchContextCharacters)
    );
    returnedPatchContextCharacters += bounded.content.length;
    if (bounded.exhausted) {
      return `[Patch omitted for ${path}: the ${PR_REVIEW_TEXT_CONTEXT_CHAR_LIMIT}-character PR review text-context budget is exhausted.]`;
    }
    if (!bounded.truncated) return bounded.content;

    return `${bounded.content}\n[Patch truncated for ${path}: returned ${bounded.content.length} of ${bounded.originalLength} characters.]`;
  };
  const reviewFindingSchema = z.object({
    severity: z.enum(["critical", "warning", "suggestion"]),
    title: z.string(),
    body: z.string(),
    path: z.string().optional(),
    line: z.number().int().positive().optional(),
  });
  const reportReviewInputSchema = z
    .object({
      hasIssues: z.boolean(),
      summary: z.string(),
      commentBody: z.string().optional(),
      affectedFiles: z.array(z.string()).max(20).optional(),
      findings: z.array(reviewFindingSchema).max(20).optional(),
    })
    .superRefine((value, ctx) => {
      if (value.hasIssues && (!value.findings || value.findings.length === 0)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["findings"],
          message:
            "findings must include at least one entry when hasIssues=true",
        });
      }
    });

  const tools = {
    getPullRequest: tool({
      description:
        "Fetch pull request metadata, including title, body, and head/base refs",
      inputSchema: z.object({}),
      execute: async () => {
        const res = await request(
          `https://api.github.com/repos/${config.owner}/${config.repo}/pulls/${config.prNumber}`,
          { headers: githubHeaders(config.githubToken) }
        );

        if (!res.ok)
          throw new Error(`GitHub API ${res.status}: PR #${config.prNumber}`);

        const data = (await res.json()) as {
          number: number;
          title: string;
          body: string | null;
          html_url: string;
          head?: { ref?: string; sha?: string };
          base?: { ref?: string; sha?: string };
        };

        return {
          number: data.number,
          title: data.title,
          body: data.body,
          url: data.html_url,
          headRef: data.head?.ref ?? config.defaultRef ?? null,
          headSha: data.head?.sha ?? null,
          baseRef: data.base?.ref ?? null,
          baseSha: data.base?.sha ?? null,
        };
      },
    }),
    listChangedFiles: tool({
      description:
        "List files changed in the pull request, including short patch snippets when GitHub provides them",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(100).default(100),
      }),
      execute: async ({ limit }) => {
        const perPage = Math.min(limit, 100);
        const res = await request(
          `https://api.github.com/repos/${config.owner}/${config.repo}/pulls/${config.prNumber}/files?per_page=${perPage}`,
          { headers: githubHeaders(config.githubToken) }
        );

        if (!res.ok)
          throw new Error(
            `GitHub API ${res.status}: PR files #${config.prNumber}`
          );

        const data = (await res.json()) as Array<{
          filename: string;
          status: string;
          additions: number;
          deletions: number;
          changes: number;
          patch?: string;
        }>;

        return {
          files: data.map((file) => ({
            path: file.filename,
            status: file.status,
            additions: file.additions,
            deletions: file.deletions,
            changes: file.changes,
            patch: boundPatch(file.filename, file.patch),
          })),
        };
      },
    }),
    fetchFile: tool({
      description:
        "Fetch bounded UTF-8 text file content from the repository, defaulting to the PR head ref when available. Binary files are described but never returned as text.",
      inputSchema: z.object({
        path: z.string(),
        ref: z.string().optional(),
      }),
      execute: async ({ path, ref }) => {
        const effectiveRef = ref || config.defaultRef;
        const query = effectiveRef
          ? `?ref=${encodeURIComponent(effectiveRef)}`
          : "";
        const res = await request(
          `https://api.github.com/repos/${contentOwner}/${contentRepo}/contents/${encodePath(path)}${query}`,
          { headers: githubHeaders(config.githubToken) }
        );

        if (!res.ok) throw new Error(`GitHub API ${res.status}: ${path}`);

        const prepared = prepareGitHubTextFile(
          (await res.json()) as GitHubFileContent | GitHubFileContent[],
          path
        );
        if (prepared.kind === "message") return prepared.content;

        const bounded = consumeTextContext(
          prepared.content,
          PR_REVIEW_FILE_CONTENT_CHAR_LIMIT
        );
        if (bounded.exhausted) {
          return `File content omitted from text review: the ${PR_REVIEW_TEXT_CONTEXT_CHAR_LIMIT}-character PR review text-context budget is exhausted.`;
        }
        if (!bounded.truncated) return bounded.content;

        return `${bounded.content}\n\n[Truncated ${path}: returned ${bounded.content.length} of ${bounded.originalLength} characters. The PR review text-context budget is ${PR_REVIEW_TEXT_CONTEXT_CHAR_LIMIT} characters.]`;
      },
    }),
    reportReview: tool({
      description:
        "Record the structured review result for workflow orchestration. Call exactly once after analysis.",
      inputSchema: reportReviewInputSchema,
      execute: async (input) => input,
    }),
  };

  if (config.allowPostComment !== true) {
    return tools;
  }

  return {
    ...tools,
    postComment: tool({
      description:
        "Post a top-level review comment on the pull request when you find issues worth flagging",
      inputSchema: z.object({ body: z.string() }),
      execute: async ({ body }) => {
        const res = await request(
          `https://api.github.com/repos/${config.owner}/${config.repo}/issues/${config.prNumber}/comments`,
          {
            method: "POST",
            headers: {
              ...githubHeaders(config.githubToken),
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ body: withAutomationMarker(body) }),
          }
        );

        if (!res.ok) {
          const errorBody = await res.text().catch(() => "");
          throw new Error(
            errorBody
              ? `GitHub comment post failed (${res.status}): ${errorBody.slice(0, 500)}`
              : `GitHub comment post failed (${res.status})`
          );
        }
        return { success: true };
      },
    }),
  };
}

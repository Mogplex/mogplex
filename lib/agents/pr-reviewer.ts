import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { withAutomationMarker } from "@/lib/github-automation-marker";
import {
  mergePullRequestIfSafe,
  queuePullRequestForMerge as queuePullRequestAutoMerge,
} from "@/lib/github-merge";
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
  // Enables PR lifecycle actions (merge/queue/rebase/close + issue creation).
  // Only flow review nodes that opted into autoMerge get these, so a plain
  // review run can never mutate the PR.
  allowPrLifecycle?: boolean;
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

  const lifecycleTools: ToolSet =
    config.allowPrLifecycle === true
      ? {
          mergePullRequest: tool({
            description:
              "Merge the pull request (squash) when GitHub reports it clean, or arm auto-merge when required checks are still pending. Only call this after reporting hasIssues=false.",
            inputSchema: z.object({
              commitTitle: z.string().optional(),
            }),
            execute: async ({ commitTitle }) =>
              mergePullRequestIfSafe({
                githubToken: config.githubToken,
                owner: config.owner,
                repo: config.repo,
                prNumber: config.prNumber,
                ...(commitTitle ? { commitTitle } : {}),
                fetchImpl: request,
              }),
          }),
          queuePullRequestForMerge: tool({
            description:
              "Queue the pull request for merging by enabling GitHub auto-merge; GitHub merges it once required checks and branch protection pass. Prefer this over mergePullRequest when checks are still running.",
            inputSchema: z.object({
              commitTitle: z.string().optional(),
            }),
            execute: async ({ commitTitle }) =>
              queuePullRequestAutoMerge({
                githubToken: config.githubToken,
                owner: config.owner,
                repo: config.repo,
                prNumber: config.prNumber,
                ...(commitTitle ? { commitTitle } : {}),
                fetchImpl: request,
              }),
          }),
          rebasePullRequest: tool({
            description:
              "Update the pull request branch with the latest base-branch changes (GitHub's update-branch mechanism, same as the 'Update branch' button). Use when the branch is behind the base before merging or queuing.",
            inputSchema: z.object({}),
            execute: async () => {
              const prRes = await request(
                `https://api.github.com/repos/${config.owner}/${config.repo}/pulls/${config.prNumber}`,
                { headers: githubHeaders(config.githubToken) }
              );
              if (!prRes.ok)
                throw new Error(
                  `GitHub API ${prRes.status}: PR #${config.prNumber}`
                );
              const pr = (await prRes.json()) as {
                state?: string;
                head?: { sha?: string };
              };
              if (pr.state !== "open") {
                return {
                  success: false as const,
                  error: `PR is ${pr.state ?? "unknown"}`,
                };
              }

              const res = await request(
                `https://api.github.com/repos/${config.owner}/${config.repo}/pulls/${config.prNumber}/update-branch`,
                {
                  method: "PUT",
                  headers: {
                    ...githubHeaders(config.githubToken),
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify(
                    pr.head?.sha ? { expected_head_sha: pr.head.sha } : {}
                  ),
                }
              );
              if (res.status === 202) {
                const data = (await res.json()) as {
                  message?: string;
                  url?: string;
                };
                return {
                  success: true as const,
                  message: data.message ?? "Updating branch",
                  url: data.url ?? null,
                };
              }
              const body = await res.text().catch(() => "");
              return {
                success: false as const,
                error: `GitHub update-branch failed (${res.status})${body ? `: ${body.slice(0, 300)}` : ""}`,
              };
            },
          }),
          closePullRequest: tool({
            description:
              "Close the pull request without merging. When closing because the change is unsafe, call createIssue first to document what breaks, then close.",
            inputSchema: z.object({}),
            execute: async () => {
              const res = await request(
                `https://api.github.com/repos/${config.owner}/${config.repo}/pulls/${config.prNumber}`,
                {
                  method: "PATCH",
                  headers: {
                    ...githubHeaders(config.githubToken),
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({ state: "closed" }),
                }
              );
              if (!res.ok) {
                const body = await res.text().catch(() => "");
                return {
                  success: false as const,
                  error: `GitHub close failed (${res.status})${body ? `: ${body.slice(0, 300)}` : ""}`,
                };
              }
              const data = (await res.json()) as {
                state?: string;
                html_url?: string;
              };
              return {
                success: true as const,
                state: data.state ?? "closed",
                url: data.html_url ?? null,
              };
            },
          }),
          createIssue: tool({
            description:
              "Create a GitHub issue documenting follow-up work — e.g. why a dependency update is blocked, what breaks, and the suggested remediation.",
            inputSchema: z.object({
              title: z.string(),
              body: z.string(),
              labels: z.array(z.string()).optional(),
            }),
            execute: async ({ title, body, labels }) => {
              const res = await request(
                `https://api.github.com/repos/${config.owner}/${config.repo}/issues`,
                {
                  method: "POST",
                  headers: {
                    ...githubHeaders(config.githubToken),
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    title,
                    body: withAutomationMarker(body),
                    labels: labels ?? [],
                  }),
                }
              );
              if (!res.ok)
                return { success: false, error: `GitHub API ${res.status}` };
              const data = (await res.json()) as {
                number?: number;
                html_url?: string;
              };
              return {
                success: true,
                issue_number: data.number,
                url: data.html_url,
              };
            },
          }),
        }
      : {};

  const commentTools: ToolSet =
    config.allowPostComment === true
      ? {
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
        }
      : {};

  return {
    ...tools,
    ...lifecycleTools,
    ...commentTools,
  };
}

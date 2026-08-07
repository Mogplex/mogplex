import { z } from "zod";
import { createGithubIssue } from "@/lib/github-issues";
import { defineTool } from "./shared";
import {
  normalizeLogin,
  normalizeRepoName,
  findInstallationToken,
} from "./github-shared";

type GithubCreateIssueOptions = { userId?: string | null };

function normalizeIssueInputs(input: {
  owner?: string;
  repo?: string;
}): { owner: string | null; repo: string | null } | { error: string } {
  const ownerResult = normalizeLogin(input.owner, "owner");
  if ("error" in ownerResult) return { error: ownerResult.error };
  const repoResult = normalizeRepoName(input.repo);
  if ("error" in repoResult) return { error: repoResult.error };
  if (repoResult.value && !ownerResult.value) {
    return { error: "owner is required when repo is provided." };
  }
  return { owner: ownerResult.value, repo: repoResult.value };
}

const githubCreateIssueParams = z
  .object({
    owner: z
      .string()
      .describe("GitHub organization or user login, e.g. 'webrenew'."),
    repo: z.string().describe("Repository name under the owner, e.g. 'tools'."),
    title: z.string().trim().min(1).max(256).describe("Issue title."),
    body: z
      .string()
      .max(65_536)
      .default("")
      .describe("Issue body in GitHub Markdown."),
    labels: z
      .array(z.string().trim().min(1).max(50))
      .max(20)
      .default([])
      .describe("Existing repository labels to attach."),
  })
  .strict();

export function createGithubIssueTool(options: GithubCreateIssueOptions = {}) {
  return defineTool({
    description:
      "Create a GitHub issue in a repository covered by the current user's Mogplex GitHub App installation. Use only when the user explicitly asks to create/file/open an issue or confirms a previously proposed issue. Requires owner and repo; returns the created issue URL.",
    inputSchema: githubCreateIssueParams,
    execute: async ({
      owner,
      repo,
      title,
      body,
      labels,
    }: z.infer<typeof githubCreateIssueParams>) => {
      const normalized = normalizeIssueInputs({ owner, repo });
      if ("error" in normalized) return { error: normalized.error };
      if (!normalized.owner || !normalized.repo)
        return { error: "owner and repo are required." };
      if (!options.userId) {
        return {
          error:
            "GitHub issue creation is unavailable because the current user is not authenticated.",
        };
      }
      let githubToken: string | null;
      try {
        githubToken = await findInstallationToken({
          userId: options.userId,
          owner: normalized.owner,
        });
      } catch (error) {
        return {
          error:
            error instanceof Error
              ? error.message
              : "GitHub App installation lookup failed.",
        };
      }
      if (!githubToken) {
        return {
          error: `GitHub issue creation is unavailable for ${normalized.owner}/${normalized.repo}. Install the Mogplex GitHub App for ${normalized.owner} and include this repository.`,
        };
      }
      try {
        const created = await createGithubIssue({
          githubToken,
          repoFullName: `${normalized.owner}/${normalized.repo}`,
          title,
          body,
          labels,
        });
        return {
          ok: true,
          repo: `${normalized.owner}/${normalized.repo}`,
          ...created,
        };
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : "GitHub issue creation failed.",
        };
      }
    },
  });
}

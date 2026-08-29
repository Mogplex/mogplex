import { z } from "zod";
import { defineTool } from "./shared";
import type {
  GithubIssueMutationAuthorization,
  GithubIssueMutationOperation,
  GithubIssueUpdateField,
} from "./github-mutation-authorization";
import {
  findInstallationToken,
  normalizeLogin,
  normalizeRepoName,
} from "./github-shared";

const GITHUB_API_ORIGIN = "https://api.github.com";

type GithubIssueMutationOptions = {
  userId?: string | null;
  authorizations?: readonly GithubIssueMutationAuthorization[];
};

const githubIssueTargetParams = z.object({
  owner: z.string().describe("GitHub organization or user login, e.g. 'acme'."),
  repo: z.string().describe("Repository name under the owner, e.g. 'widgets'."),
  number: z.number().int().positive().describe("Issue number."),
});

const githubIssueUpdateParams = githubIssueTargetParams
  .extend({
    title: z.string().trim().min(1).max(256).optional(),
    body: z.string().max(65_536).optional(),
    state: z.enum(["open", "closed"]).optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.title !== undefined ||
      input.body !== undefined ||
      input.state !== undefined,
    { message: "Provide a title, body, or state to update." }
  );

const githubIssueCommentParams = githubIssueTargetParams
  .extend({
    body: z.string().trim().min(1).max(65_536).describe("Comment body."),
  })
  .strict();

function normalizeIssueTarget(input: { owner: string; repo: string }) {
  const owner = normalizeLogin(input.owner, "owner");
  if ("error" in owner) return owner;
  const repo = normalizeRepoName(input.repo);
  if ("error" in repo) return repo;
  if (!owner.value || !repo.value) {
    return { error: "owner and repo are required." };
  }
  return { owner: owner.value, repo: repo.value };
}

function isAuthorizedIssueMutation(input: {
  authorizations?: readonly GithubIssueMutationAuthorization[];
  operation: GithubIssueMutationOperation;
  owner: string;
  repo: string;
  number: number;
  requestedFields?: readonly GithubIssueUpdateField[];
  requestedState?: "open" | "closed";
}) {
  return input.authorizations?.some(
    (authorization) =>
      authorization.operation === input.operation &&
      authorization.owner.toLowerCase() === input.owner.toLowerCase() &&
      authorization.repo.toLowerCase() === input.repo.toLowerCase() &&
      authorization.number === input.number &&
      authorizationAllowsIssueRequest(authorization, input)
  );
}

function authorizationAllowsIssueRequest(
  authorization: GithubIssueMutationAuthorization,
  request: {
    requestedFields?: readonly GithubIssueUpdateField[];
    requestedState?: "open" | "closed";
  }
) {
  if (authorization.operation === "comment") return true;
  if (
    request.requestedFields?.some(
      (field) => !authorization.allowedFields.includes(field)
    )
  ) {
    return false;
  }
  return !authorization.state || authorization.state === request.requestedState;
}

async function resolveIssueMutationContext(input: {
  owner: string;
  repo: string;
  number: number;
  operation: GithubIssueMutationOperation;
  requestedFields?: readonly GithubIssueUpdateField[];
  requestedState?: "open" | "closed";
  authorizations?: readonly GithubIssueMutationAuthorization[];
  userId?: string | null;
}) {
  const target = normalizeIssueTarget(input);
  if ("error" in target) return target;
  if (!input.userId) {
    return {
      error:
        "GitHub issue changes are unavailable because the current user is not authenticated.",
    };
  }
  if (
    !isAuthorizedIssueMutation({
      authorizations: input.authorizations,
      operation: input.operation,
      owner: target.owner,
      repo: target.repo,
      number: input.number,
      requestedFields: input.requestedFields,
      requestedState: input.requestedState,
    })
  ) {
    return {
      error:
        "This GitHub issue change was not explicitly authorized by the current user request. Ask the user to name the repository and issue number in the requested write action.",
    };
  }
  let githubToken: string | null;
  try {
    githubToken = await findInstallationToken({
      userId: input.userId,
      owner: target.owner,
    });
  } catch {
    return {
      error:
        "GitHub issue changes are temporarily unavailable. Check the repository connection, then retry.",
    };
  }
  if (!githubToken) {
    return {
      error: `GitHub issue changes are unavailable for ${target.owner}/${target.repo}. Connect that repository with issue write access, then retry.`,
    };
  }
  return { ...target, githubToken };
}

function githubMutationHeaders(githubToken: string) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${githubToken}`,
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "mogplex-agent",
  };
}

function buildIssueUpdates(input: {
  title?: string;
  body?: string;
  state?: "open" | "closed";
}) {
  return {
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.body === undefined ? {} : { body: input.body }),
    ...(input.state === undefined ? {} : { state: input.state }),
  };
}

function requestedIssueUpdateFields(input: {
  title?: string;
  body?: string;
  state?: "open" | "closed";
}) {
  const fields: GithubIssueUpdateField[] = [];
  if (input.title !== undefined) fields.push("title");
  if (input.body !== undefined) fields.push("body");
  if (input.state !== undefined) fields.push("state");
  return fields;
}

async function verifyIssueResource(input: {
  owner: string;
  repo: string;
  number: number;
  githubToken: string;
}) {
  const response = await fetch(
    new URL(
      `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/issues/${input.number}`,
      GITHUB_API_ORIGIN
    ),
    { headers: githubMutationHeaders(input.githubToken) }
  );
  const resource = (await response.json().catch(() => ({}))) as {
    pull_request?: unknown;
    message?: string;
  };
  if (!response.ok) {
    return {
      error:
        resource.message ||
        `GitHub could not verify issue #${input.number} (${response.status}).`,
    };
  }
  if (resource.pull_request) {
    return {
      error:
        "The authorized target is a pull request, not an issue. Use an explicitly authorized pull request action instead.",
    };
  }
  return null;
}

export function createGithubIssueUpdateTool(
  options: GithubIssueMutationOptions = {}
) {
  return defineTool({
    description:
      "Update the title, body, or state of an existing GitHub issue in a repository covered by the current user's GitHub connection. Use the current issue body when appending an annotation so unrelated content is preserved.",
    inputSchema: githubIssueUpdateParams,
    execute: async ({
      owner,
      repo,
      number,
      title,
      body,
      state,
    }: z.infer<typeof githubIssueUpdateParams>) => {
      const context = await resolveIssueMutationContext({
        owner,
        repo,
        number,
        operation: "update",
        authorizations: options.authorizations,
        requestedFields: requestedIssueUpdateFields({ title, body, state }),
        requestedState: state,
        userId: options.userId,
      });
      if ("error" in context) return { error: context.error };
      const resourceError = await verifyIssueResource({
        ...context,
        number,
      });
      if (resourceError) return resourceError;
      const updates = buildIssueUpdates({ title, body, state });
      const response = await fetch(
        new URL(
          `/repos/${encodeURIComponent(context.owner)}/${encodeURIComponent(context.repo)}/issues/${number}`,
          GITHUB_API_ORIGIN
        ),
        {
          method: "PATCH",
          headers: githubMutationHeaders(context.githubToken),
          body: JSON.stringify(updates),
        }
      );
      const updated = (await response.json().catch(() => ({}))) as {
        number?: number;
        html_url?: string;
        title?: string;
        body?: string | null;
        state?: string;
        message?: string;
      };
      if (!response.ok || !updated.html_url) {
        return {
          error:
            updated.message ||
            `GitHub could not update issue #${number} (${response.status}).`,
        };
      }
      return {
        ok: true,
        repo: `${context.owner}/${context.repo}`,
        issueNumber: updated.number ?? number,
        issueUrl: updated.html_url,
        title: updated.title ?? null,
        body: updated.body ?? "",
        state: updated.state ?? null,
      };
    },
  });
}

export function createGithubIssueCommentTool(
  options: GithubIssueMutationOptions = {}
) {
  return defineTool({
    description:
      "Add a comment to an existing GitHub issue or pull request in a repository covered by the current user's GitHub connection. Use this for annotations that should not replace the issue body.",
    inputSchema: githubIssueCommentParams,
    execute: async ({
      owner,
      repo,
      number,
      body,
    }: z.infer<typeof githubIssueCommentParams>) => {
      const context = await resolveIssueMutationContext({
        owner,
        repo,
        number,
        operation: "comment",
        authorizations: options.authorizations,
        userId: options.userId,
      });
      if ("error" in context) return { error: context.error };
      const response = await fetch(
        new URL(
          `/repos/${encodeURIComponent(context.owner)}/${encodeURIComponent(context.repo)}/issues/${number}/comments`,
          GITHUB_API_ORIGIN
        ),
        {
          method: "POST",
          headers: githubMutationHeaders(context.githubToken),
          body: JSON.stringify({ body }),
        }
      );
      const comment = (await response.json().catch(() => ({}))) as {
        html_url?: string;
        body?: string;
        message?: string;
      };
      if (!response.ok || !comment.html_url) {
        return {
          error:
            comment.message ||
            `GitHub could not comment on issue #${number} (${response.status}).`,
        };
      }
      return {
        ok: true,
        repo: `${context.owner}/${context.repo}`,
        issueNumber: number,
        commentUrl: comment.html_url,
        body: comment.body ?? body,
      };
    },
  });
}

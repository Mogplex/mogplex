const GITHUB_API_BASE = "https://api.github.com";

type GithubMutationResponse = {
  id?: number;
  number?: number;
  html_url?: string | null;
  state?: string;
  context?: string;
  sha?: string;
  labels?: Array<{ name?: string }>;
  message?: string;
};

function parseRepoFullName(repoFullName: string) {
  const [owner, repo, ...rest] = repoFullName.split("/");
  if (!owner || !repo || rest.length > 0) {
    throw new Error(`Invalid GitHub repository name: ${repoFullName}`);
  }
  return { owner, repo };
}

function githubHeaders(token: string) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": "mogplex",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function githubRequest(input: {
  githubToken: string;
  path: string;
  method: "GET" | "POST" | "DELETE";
  body?: Record<string, unknown>;
  operation: string;
  acceptedStatuses?: readonly number[];
  fetchImpl?: typeof fetch;
}) {
  const response = await (input.fetchImpl ?? fetch)(
    `${GITHUB_API_BASE}${input.path}`,
    {
      method: input.method,
      headers: githubHeaders(input.githubToken),
      body: input.body ? JSON.stringify(input.body) : undefined,
    }
  );
  const payload = (await response
    .json()
    .catch(() => null)) as GithubMutationResponse | null;
  if (!response.ok && !input.acceptedStatuses?.includes(response.status)) {
    const detail =
      payload?.message || response.statusText || "Unknown GitHub API error";
    throw new Error(
      `GitHub ${input.operation} failed (${response.status}): ${detail}`
    );
  }
  return payload;
}

export async function postGithubComment(input: {
  githubToken: string;
  repoFullName: string;
  targetNumber: number;
  body: string;
  fetchImpl?: typeof fetch;
}) {
  const { owner, repo } = parseRepoFullName(input.repoFullName);
  const payload = await githubRequest({
    githubToken: input.githubToken,
    path: `/repos/${owner}/${repo}/issues/${input.targetNumber}/comments`,
    method: "POST",
    body: { body: input.body },
    operation: "comment create",
    fetchImpl: input.fetchImpl,
  });
  if (typeof payload?.id !== "number") {
    throw new TypeError("GitHub comment create failed: missing comment id");
  }
  return {
    commentId: payload.id,
    commentUrl: typeof payload.html_url === "string" ? payload.html_url : null,
  };
}

export async function createGithubIssueAction(input: {
  githubToken: string;
  repoFullName: string;
  title: string;
  body: string;
  labels: string[];
  fetchImpl?: typeof fetch;
}) {
  const { owner, repo } = parseRepoFullName(input.repoFullName);
  const payload = await githubRequest({
    githubToken: input.githubToken,
    path: `/repos/${owner}/${repo}/issues`,
    method: "POST",
    body: {
      title: input.title,
      body: input.body,
      labels: input.labels,
    },
    operation: "issue create",
    fetchImpl: input.fetchImpl,
  });
  if (typeof payload?.number !== "number") {
    throw new TypeError("GitHub issue create failed: missing issue number");
  }
  return {
    issueNumber: payload.number,
    issueUrl: typeof payload.html_url === "string" ? payload.html_url : null,
  };
}

export async function updateGithubLabels(input: {
  githubToken: string;
  repoFullName: string;
  targetNumber: number;
  addLabels: string[];
  removeLabels: string[];
  fetchImpl?: typeof fetch;
}) {
  const { owner, repo } = parseRepoFullName(input.repoFullName);
  let labels: string[] | null = null;

  if (input.addLabels.length > 0) {
    const payload = await githubRequest({
      githubToken: input.githubToken,
      path: `/repos/${owner}/${repo}/issues/${input.targetNumber}/labels`,
      method: "POST",
      body: { labels: input.addLabels },
      operation: "label add",
      fetchImpl: input.fetchImpl,
    });
    labels = Array.isArray(payload)
      ? payload.flatMap((label) =>
          typeof label?.name === "string" ? [label.name] : []
        )
      : null;
  }

  if (input.removeLabels.length > 0) {
    if (labels === null) {
      const payload = await githubRequest({
        githubToken: input.githubToken,
        path: `/repos/${owner}/${repo}/issues/${input.targetNumber}`,
        method: "GET",
        operation: "issue labels read",
        fetchImpl: input.fetchImpl,
      });
      labels = Array.isArray(payload?.labels)
        ? payload.labels.flatMap((label) =>
            typeof label?.name === "string" ? [label.name] : []
          )
        : [];
    }

    const attachedLabels = new Map(
      labels.map((label) => [label.toLowerCase(), label])
    );
    for (const label of input.removeLabels) {
      const attachedLabel = attachedLabels.get(label.toLowerCase());
      if (!attachedLabel) continue;
      await githubRequest({
        githubToken: input.githubToken,
        path: `/repos/${owner}/${repo}/issues/${input.targetNumber}/labels/${encodeURIComponent(attachedLabel)}`,
        method: "DELETE",
        operation: "label remove",
        acceptedStatuses: [404],
        fetchImpl: input.fetchImpl,
      });
      attachedLabels.delete(label.toLowerCase());
    }
    labels = Array.from(attachedLabels.values());
  }

  return {
    addedLabels: input.addLabels,
    removedLabels: input.removeLabels,
    labels,
  };
}

export async function setGithubCommitStatus(input: {
  githubToken: string;
  repoFullName: string;
  commitSha: string;
  state: "pending" | "success" | "failure" | "error";
  context: string;
  description: string | null;
  targetUrl: string | null;
  fetchImpl?: typeof fetch;
}) {
  const { owner, repo } = parseRepoFullName(input.repoFullName);
  const payload = await githubRequest({
    githubToken: input.githubToken,
    path: `/repos/${owner}/${repo}/statuses/${input.commitSha}`,
    method: "POST",
    body: {
      state: input.state,
      context: input.context,
      description: input.description ?? undefined,
      target_url: input.targetUrl ?? undefined,
    },
    operation: "commit status create",
    fetchImpl: input.fetchImpl,
  });
  return {
    statusId: typeof payload?.id === "number" ? payload.id : null,
    statusUrl: typeof payload?.html_url === "string" ? payload.html_url : null,
    state: typeof payload?.state === "string" ? payload.state : input.state,
    context:
      typeof payload?.context === "string" ? payload.context : input.context,
    commitSha: typeof payload?.sha === "string" ? payload.sha : input.commitSha,
  };
}

export async function submitGithubPullRequestReview(input: {
  githubToken: string;
  repoFullName: string;
  pullRequestNumber: number;
  event: "COMMENT" | "APPROVE" | "REQUEST_CHANGES";
  body: string;
  commitSha: string | null;
  fetchImpl?: typeof fetch;
}) {
  const { owner, repo } = parseRepoFullName(input.repoFullName);
  const payload = await githubRequest({
    githubToken: input.githubToken,
    path: `/repos/${owner}/${repo}/pulls/${input.pullRequestNumber}/reviews`,
    method: "POST",
    body: {
      event: input.event,
      body: input.body,
      commit_id: input.commitSha ?? undefined,
    },
    operation: "pull request review create",
    fetchImpl: input.fetchImpl,
  });
  if (typeof payload?.id !== "number") {
    throw new TypeError(
      "GitHub pull request review create failed: missing review id"
    );
  }
  return {
    reviewId: payload.id,
    reviewUrl: typeof payload.html_url === "string" ? payload.html_url : null,
  };
}

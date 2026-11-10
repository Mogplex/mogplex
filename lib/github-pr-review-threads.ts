import {
  GITHUB_API_BASE,
  getGithubHeaders,
  parseRepoFullName,
} from "./github-check-runs.internals";

export type PrReviewThreadComment = {
  author: string | null;
  body: string;
  createdAt: string;
};

export type PrReviewThread = {
  id: string;
  isResolved: boolean;
  path: string | null;
  line: number | null;
  url: string | null;
  comments: PrReviewThreadComment[];
};

export type PrConversationComment = {
  author: string | null;
  isBot: boolean;
  body: string;
  createdAt: string;
};

const THREADS_QUERY = `query($owner: String!, $repo: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          isResolved
          path
          line
          root: comments(first: 1) {
            nodes { id body url createdAt author { login } }
          }
          recent: comments(last: 20) {
            nodes { id body url createdAt author { login } }
          }
        }
      }
    }
  }
}`;

async function githubGraphql<T>(
  githubToken: string,
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  const response = await fetch(`${GITHUB_API_BASE}/graphql`, {
    method: "POST",
    headers: getGithubHeaders(githubToken),
    body: JSON.stringify({ query, variables }),
  });
  const payload = (await response.json().catch(() => null)) as {
    data?: T;
    errors?: Array<{ message?: string }>;
  } | null;
  if (!response.ok || !payload?.data || payload.errors?.length) {
    const message = payload?.errors?.[0]?.message ?? response.statusText;
    throw new Error(
      `GitHub GraphQL request failed (${response.status}): ${message}`
    );
  }
  return payload.data;
}

type ThreadCommentNode = {
  id: string;
  body: string;
  url: string;
  createdAt: string;
  author: { login: string } | null;
};

type ThreadsPage = {
  repository: {
    pullRequest: {
      reviewThreads: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: Array<{
          id: string;
          isResolved: boolean;
          path: string | null;
          line: number | null;
          root: { nodes: ThreadCommentNode[] };
          recent: { nodes: ThreadCommentNode[] };
        }>;
      };
    } | null;
  } | null;
};

/** Every review thread on a pull request, with its comments. */
export async function listPrReviewThreads(input: {
  githubToken: string;
  repoFullName: string;
  prNumber: number;
}): Promise<PrReviewThread[]> {
  const { owner, repo } = parseRepoFullName(input.repoFullName);
  const threads: PrReviewThread[] = [];
  let after: string | null = null;
  for (;;) {
    const page: ThreadsPage = await githubGraphql<ThreadsPage>(
      input.githubToken,
      THREADS_QUERY,
      { owner, repo, number: input.prNumber, after }
    );
    const connection = page.repository?.pullRequest?.reviewThreads;
    if (!connection) return threads;
    for (const node of connection.nodes) {
      // The first comment carries the finding marker; the latest hundred
      // carry the discussion. Together they cover any thread length.
      const root = node.root.nodes[0];
      const recent = node.recent.nodes.filter(
        (comment) => comment.id !== root?.id
      );
      const comments = root ? [root, ...recent] : recent;
      threads.push({
        id: node.id,
        isResolved: node.isResolved,
        path: node.path,
        line: node.line,
        url: root?.url ?? null,
        comments: comments.map((comment) => ({
          author: comment.author?.login ?? null,
          body: comment.body,
          createdAt: comment.createdAt,
        })),
      });
    }
    const next = connection.pageInfo.endCursor;
    // A next page needs a new cursor; anything else would loop on one page.
    if (!connection.pageInfo.hasNextPage || !next || next === after) {
      return threads;
    }
    after = next;
  }
}

/** Reply to a review thread, then resolve it. */
export async function replyAndResolvePrReviewThread(input: {
  githubToken: string;
  threadId: string;
  body: string;
}) {
  await githubGraphql(
    input.githubToken,
    `mutation($thread: ID!, $body: String!) {
      addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $thread, body: $body }) { comment { id } }
    }`,
    { thread: input.threadId, body: input.body }
  );
  await githubGraphql(
    input.githubToken,
    `mutation($thread: ID!) {
      resolveReviewThread(input: { threadId: $thread }) { thread { isResolved } }
    }`,
    { thread: input.threadId }
  );
}

/**
 * How `head` relates to `base`, and the files that differ. GitHub returns at
 * most 300 files for a comparison; `complete` is false when it may have cut
 * the list.
 */
export async function comparePrCommits(input: {
  githubToken: string;
  repoFullName: string;
  base: string;
  head: string;
}): Promise<{ status: string; files: string[]; complete: boolean }> {
  const { owner, repo } = parseRepoFullName(input.repoFullName);
  const response = await fetch(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/compare/${encodeURIComponent(input.base)}...${encodeURIComponent(input.head)}`,
    { headers: getGithubHeaders(input.githubToken) }
  );
  const payload = (await response.json().catch(() => null)) as {
    status?: unknown;
    files?: Array<{ filename?: unknown }>;
  } | null;
  if (!response.ok || typeof payload?.status !== "string") {
    throw new Error(`GitHub compare failed (${response.status})`);
  }
  const files = (payload.files ?? []).flatMap((file) =>
    typeof file.filename === "string" ? [file.filename] : []
  );
  return { status: payload.status, files, complete: files.length < 300 };
}

const COMMENTS_PAGE_SIZE = 100;

/** PR conversation comments created after `since`, oldest first. */
export async function listPrConversationComments(input: {
  githubToken: string;
  repoFullName: string;
  prNumber: number;
  since: string;
}): Promise<PrConversationComment[]> {
  const { owner, repo } = parseRepoFullName(input.repoFullName);
  const comments: PrConversationComment[] = [];
  for (let page = 1; ; page += 1) {
    const response = await fetch(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/issues/${input.prNumber}/comments?since=${encodeURIComponent(input.since)}&per_page=${COMMENTS_PAGE_SIZE}&page=${page}`,
      { headers: getGithubHeaders(input.githubToken) }
    );
    const payload = (await response.json().catch(() => null)) as unknown;
    if (!response.ok || !Array.isArray(payload)) {
      throw new Error(`GitHub PR comments lookup failed (${response.status})`);
    }
    for (const entry of payload as Array<{
      body?: unknown;
      created_at?: unknown;
      user?: { login?: unknown; type?: unknown } | null;
    }>) {
      if (
        typeof entry.body !== "string" ||
        typeof entry.created_at !== "string"
      )
        continue;
      // `since` filters on update time; keep only comments made after it.
      if (Date.parse(entry.created_at) <= Date.parse(input.since)) continue;
      comments.push({
        author: typeof entry.user?.login === "string" ? entry.user.login : null,
        isBot: entry.user?.type === "Bot",
        body: entry.body,
        createdAt: entry.created_at,
      });
    }
    if (payload.length < COMMENTS_PAGE_SIZE) return comments;
  }
}

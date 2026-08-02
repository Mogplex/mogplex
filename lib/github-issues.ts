const GITHUB_API_BASE = "https://api.github.com";

type ParsedRepo = {
  owner: string;
  repo: string;
};

type GithubIssueResponse = {
  number?: number;
  html_url?: string | null;
  message?: string;
};

function parseRepoFullName(repoFullName: string): ParsedRepo {
  const [owner, repo] = repoFullName.split("/");

  if (!owner || !repo) {
    throw new Error(`Invalid GitHub repository name: ${repoFullName}`);
  }

  return { owner, repo };
}

function getGithubHeaders(token: string) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": "mogplex",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

export async function createGithubIssue(input: {
  githubToken: string;
  repoFullName: string;
  title: string;
  body: string;
  labels?: string[];
}) {
  const { owner, repo } = parseRepoFullName(input.repoFullName);
  const response = await fetch(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/issues`,
    {
      method: "POST",
      headers: getGithubHeaders(input.githubToken),
      body: JSON.stringify({
        title: input.title,
        body: input.body,
        labels: input.labels ?? [],
      }),
    }
  );

  const payload = (await response
    .json()
    .catch(() => null)) as GithubIssueResponse | null;

  if (!response.ok) {
    const message =
      payload?.message || response.statusText || "Unknown GitHub API error";
    throw new Error(
      `GitHub issue create failed (${response.status}): ${message}`
    );
  }

  if (typeof payload?.number !== "number") {
    throw new TypeError("GitHub issue create failed: missing issue number");
  }

  return {
    issueNumber: payload.number,
    issueUrl: typeof payload.html_url === "string" ? payload.html_url : null,
  };
}

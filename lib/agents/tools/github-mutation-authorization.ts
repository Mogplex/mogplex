export type GithubMutationTarget = {
  owner: string;
  repo: string;
  number: number;
};

export type GithubPullRequestMergeAuthorization = GithubMutationTarget;

export type GithubRequestMutationAuthorizations = {
  pullRequestMerge: GithubPullRequestMergeAuthorization | null;
};

type GithubRequestAuthorizationInput = {
  userText?: string | null;
  repoOwner?: string | null;
  repoName?: string | null;
};

type ExplicitCommand = {
  operation: "merge";
  text: string;
  arguments: string;
};

const COMMAND_OPENING =
  String.raw`(?:(?:please|now)\s+|` +
  String.raw`(?:can|could|would|will)\s+you\s+(?:please\s+)?|` +
  String.raw`i\s+(?:want|need)\s+you\s+to\s+)?`;

const MERGE_ACTION = String.raw`(?:squash[- ]?)?merge\b`;
const GITHUB_TARGET_URL =
  /github\.com\/([a-z\d](?:[a-z\d-]{0,38}))\/([a-z\d._-]+)\/(issues|pull)\/(\d+)/gi;
const SHORTHAND_TARGET =
  /\b([a-z\d](?:[a-z\d-]{0,38}))\/([a-z\d._-]+?)#(\d+)\b/gi;

function explicitCommand(
  text: string,
  actionSource: string,
  operation: ExplicitCommand["operation"]
) {
  if (/\b(?:if|unless|when|assuming|provided\s+that|only\s+if)\b/i.test(text)) {
    return null;
  }
  const pattern = new RegExp(
    String.raw`^\s*${COMMAND_OPENING}(?<action>${actionSource})(?<arguments>[\s\S]+?)\s*[.!?]?\s*$`,
    "i"
  );
  const match = text.match(pattern);
  const actionText = match?.groups?.action;
  const args = match?.groups?.arguments?.trim();
  if (!actionText || !args) return null;
  if (/\b(?:merge|comment|annotate|update|edit|close|reopen)\b/i.test(args)) {
    return null;
  }
  return { operation, text: actionText, arguments: args };
}

function addTarget(
  targets: Map<string, GithubMutationTarget>,
  owner: string,
  repo: string,
  number: string | number
) {
  const normalizedRepo = repo.replace(/\.git$/i, "");
  const target = { owner, repo: normalizedRepo, number: Number(number) };
  targets.set(
    `${owner.toLowerCase()}/${normalizedRepo.toLowerCase()}#${target.number}`,
    target
  );
}

function directTargets(clause: string, allowedPaths: ReadonlySet<string>) {
  const targets = new Map<string, GithubMutationTarget>();
  const withoutUrls = clause.replace(
    GITHUB_TARGET_URL,
    (match, owner: string, repo: string, path: string, number: string) => {
      if (allowedPaths.has(path.toLowerCase())) {
        addTarget(targets, owner, repo, number);
      }
      return " ".repeat(match.length);
    }
  );
  const residual = withoutUrls.replace(
    SHORTHAND_TARGET,
    (match, owner: string, repo: string, number: string) => {
      addTarget(targets, owner, repo, number);
      return " ".repeat(match.length);
    }
  );
  return { targets, residual };
}

function addTextualPullRequestTargets(
  targets: Map<string, GithubMutationTarget>,
  text: string
) {
  const repoFirst =
    /\b([a-z\d](?:[a-z\d-]{0,38}))\/([a-z\d._-]+)\s+(?:pull request|pr)\s*#?\s*(\d+)\b/gi;
  for (const match of text.matchAll(repoFirst)) {
    addTarget(targets, match[1], match[2], match[3]);
  }
  const prFirst =
    /\b(?:pull request|pr)\s*#?\s*(\d+)\s+(?:in|on|from)\s+([a-z\d](?:[a-z\d-]{0,38}))\/([a-z\d._-]+)\b/gi;
  for (const match of text.matchAll(prFirst)) {
    addTarget(targets, match[2], match[3], match[1]);
  }
}

function contextualPullRequestTarget(
  text: string,
  input: GithubRequestAuthorizationInput
) {
  if (!input.repoOwner || !input.repoName) return null;
  const matches = [...text.matchAll(/(?:\bpr\s*#?\s*|#)(\d+)\b/gi)].map(
    (match) => match[1]
  );
  if (new Set(matches).size !== 1) return null;
  return {
    owner: input.repoOwner,
    repo: input.repoName,
    number: Number(matches[0]),
  };
}

function derivePullRequestMergeAuthorization(
  text: string,
  input: GithubRequestAuthorizationInput
) {
  const command = explicitCommand(text, MERGE_ACTION, "merge");
  if (!command) return null;
  const clause = command.arguments;
  const { targets, residual } = directTargets(clause, new Set(["pull"]));
  addTextualPullRequestTargets(targets, residual);
  if (targets.size === 0) {
    const contextual = contextualPullRequestTarget(residual, input);
    if (contextual)
      addTarget(targets, contextual.owner, contextual.repo, contextual.number);
  }
  return targets.size === 1 ? [...targets.values()][0] : null;
}

export function deriveGithubRequestMutationAuthorizations(
  input: GithubRequestAuthorizationInput
): GithubRequestMutationAuthorizations {
  const text = input.userText?.trim() ?? "";
  if (!text) return { pullRequestMerge: null };
  return {
    pullRequestMerge: derivePullRequestMergeAuthorization(text, input),
  };
}

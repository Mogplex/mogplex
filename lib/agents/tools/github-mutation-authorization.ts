export type GithubMutationTarget = {
  owner: string;
  repo: string;
  number: number;
};

export type GithubPullRequestMergeAuthorization = GithubMutationTarget;

export type GithubIssueMutationOperation = "update" | "comment";

export type GithubIssueUpdateField = "title" | "body" | "state";

export type GithubIssueMutationAuthorization = GithubMutationTarget &
  (
    | { operation: "comment" }
    | {
        operation: "update";
        allowedFields: GithubIssueUpdateField[];
        state?: "open" | "closed";
      }
  );

export type GithubRequestMutationAuthorizations = {
  pullRequestMerge: GithubPullRequestMergeAuthorization | null;
  issueMutations: GithubIssueMutationAuthorization[];
};

type GithubRequestAuthorizationInput = {
  userText?: string | null;
  repoOwner?: string | null;
  repoName?: string | null;
};

type ExplicitAction = {
  start: number;
  end: number;
  operation: GithubIssueMutationOperation | "merge";
  text: string;
};

const REQUEST_PREFIX =
  String.raw`(?:^|[.!?]\s*|\bplease\s+|\bthen\s+|\bnow\s+|` +
  String.raw`\b(?:can|could|would|will)\s+you\s+(?:please\s+)?|` +
  String.raw`\bi\s+(?:want|need)\s+you\s+to\s+)`;

const MERGE_ACTION = String.raw`(?:squash[- ]?)?merge\b`;
const COMMENT_ACTION =
  String.raw`(?:comment(?:\s+on)?|annotate|` +
  String.raw`add\s+(?:a\s+)?(?:comment|note)(?:\s+to)?|` +
  String.raw`post\s+(?:a\s+)?comment(?:\s+on)?|reply\s+to)\b`;
const UPDATE_ACTION =
  String.raw`(?:(?:update|edit|change)\s+(?:the\s+)?(?:github\s+)?issues?|` +
  String.raw`(?:update|edit|change)\s+(?:the\s+)?(?:title|body|description|state)` +
  String.raw`\s+(?:of|on)\s+(?:the\s+)?(?:github\s+)?issue|` +
  String.raw`(?:close|reopen)\s+(?:the\s+)?(?:github\s+)?issue)\b`;

const GITHUB_TARGET_URL =
  /github\.com\/([a-z\d](?:[a-z\d-]{0,38}))\/([a-z\d._-]+)\/(issues|pull)\/(\d+)/gi;
const SHORTHAND_TARGET =
  /\b([a-z\d](?:[a-z\d-]{0,38}))\/([a-z\d._-]+?)#(\d+)\b/gi;
const REPOSITORY = /\b([a-z\d](?:[a-z\d-]{0,38}))\/([a-z\d._-]+)\b/gi;

function explicitActions(
  text: string,
  actionSource: string,
  operation: ExplicitAction["operation"]
) {
  const matches: ExplicitAction[] = [];
  const pattern = new RegExp(`${REQUEST_PREFIX}(?:${actionSource})`, "gim");
  for (const match of text.matchAll(pattern)) {
    matches.push({
      start: match.index,
      end: match.index + match[0].length,
      operation,
      text: match[0],
    });
  }
  return matches;
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
  const actions = explicitActions(text, MERGE_ACTION, "merge");
  if (actions.length !== 1) return null;
  const clause = text.slice(actions[0].end);
  const { targets, residual } = directTargets(clause, new Set(["pull"]));
  addTextualPullRequestTargets(targets, residual);
  if (targets.size === 0) {
    const contextual = contextualPullRequestTarget(residual, input);
    if (contextual)
      addTarget(targets, contextual.owner, contextual.repo, contextual.number);
  }
  return targets.size === 1 ? [...targets.values()][0] : null;
}

function repositories(text: string) {
  const found = new Map<string, { owner: string; repo: string }>();
  for (const match of text.matchAll(REPOSITORY)) {
    const repo = match[2].replace(/\.git$/i, "");
    found.set(`${match[1].toLowerCase()}/${repo.toLowerCase()}`, {
      owner: match[1],
      repo,
    });
  }
  return [...found.values()];
}

function issueNumbers(text: string) {
  const numbers = [...text.matchAll(/#(\d+)\b/g)].map((match) => match[1]);
  const leading = text.match(/^\s*(\d+)\b/);
  if (leading) numbers.push(leading[1]);
  return [...new Set(numbers)];
}

function issueTargets(
  clause: string,
  operation: GithubIssueMutationOperation,
  input: GithubRequestAuthorizationInput
) {
  const targetClause = clause.split(
    /\b(?:with|saying|to say|using the text|using this text)\b/i,
    1
  )[0];
  const allowedPaths =
    operation === "comment" ? new Set(["issues", "pull"]) : new Set(["issues"]);
  const { targets, residual } = directTargets(targetClause, allowedPaths);
  const repos = repositories(residual);
  const numbers = issueNumbers(residual);
  const contextualRepo =
    repos.length === 0 && input.repoOwner && input.repoName
      ? { owner: input.repoOwner, repo: input.repoName }
      : null;
  const repo = repos.length === 1 ? repos[0] : contextualRepo;
  if (repo) {
    for (const number of numbers) {
      addTarget(targets, repo.owner, repo.repo, number);
    }
  }
  return [...targets.values()];
}

function updateAuthorizationConstraints(actionText: string): {
  allowedFields: GithubIssueUpdateField[];
  state?: "open" | "closed";
} {
  const text = actionText.toLowerCase();
  if (/\breopen\b/.test(text)) {
    return { allowedFields: ["state"], state: "open" };
  }
  if (/\bclose\b/.test(text)) {
    return { allowedFields: ["state"], state: "closed" };
  }
  const fields: GithubIssueUpdateField[] = [];
  if (/\btitle\b/.test(text)) fields.push("title");
  if (/\b(?:body|description)\b/.test(text)) fields.push("body");
  if (/\bstate\b/.test(text)) fields.push("state");
  return {
    allowedFields: fields.length > 0 ? fields : ["title", "body", "state"],
  };
}

function deriveIssueMutationAuthorizations(
  text: string,
  input: GithubRequestAuthorizationInput
) {
  const actions = [
    ...explicitActions(text, COMMENT_ACTION, "comment"),
    ...explicitActions(text, UPDATE_ACTION, "update"),
  ].sort((left, right) => left.start - right.start);
  const authorizations: GithubIssueMutationAuthorization[] = [];
  for (const [index, action] of actions.entries()) {
    const clauseEnd = actions[index + 1]?.start ?? text.length;
    const clause = text.slice(action.end, clauseEnd);
    const operation = action.operation as GithubIssueMutationOperation;
    for (const target of issueTargets(clause, operation, input)) {
      authorizations.push(
        operation === "comment"
          ? { ...target, operation }
          : {
              ...target,
              operation,
              ...updateAuthorizationConstraints(action.text),
            }
      );
    }
  }
  return authorizations;
}

export function deriveGithubRequestMutationAuthorizations(
  input: GithubRequestAuthorizationInput
): GithubRequestMutationAuthorizations {
  const text = input.userText?.trim() ?? "";
  if (!text) return { pullRequestMerge: null, issueMutations: [] };
  return {
    pullRequestMerge: derivePullRequestMergeAuthorization(text, input),
    issueMutations: deriveIssueMutationAuthorizations(text, input),
  };
}

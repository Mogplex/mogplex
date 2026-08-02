export type GithubObservabilityLinkKind =
  | "pr"
  | "pr_comment"
  | "issue"
  | "issue_comment"
  | "commit"
  | "compare"
  | "check"
  | "run";

export type GithubObservabilityLink = {
  href: string;
  label: string;
  kind: GithubObservabilityLinkKind;
};

type GithubMetadataFallback = {
  issueNumber: number | null;
  prNumber: number | null;
  commitId: string | null;
  isPr: boolean;
};

function toOptionalTrimmedString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toOptionalPositiveInteger(value: unknown) {
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeGithubUrl(value: unknown) {
  const raw = toOptionalTrimmedString(value);
  if (raw == null) return null;

  try {
    const parsed = new URL(raw);
    const normalizedPath = parsed.pathname.replace(/\/+$/, "");

    if (parsed.protocol !== "https:" || parsed.hostname !== "github.com") {
      return null;
    }

    if (normalizedPath.length <= 1) {
      return null;
    }

    return `https://github.com${normalizedPath}${parsed.hash}`;
  } catch {
    return null;
  }
}

function normalizeRepoFullName(value: unknown) {
  const trimmed = toOptionalTrimmedString(value);
  if (trimmed == null) return null;

  return /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(trimmed) ? trimmed : null;
}

function buildGithubMetadataLink(input: {
  sourceType: string | null;
  metadata: Record<string, unknown> | null;
}): GithubObservabilityLink | GithubMetadataFallback | null {
  const metadata = input.metadata;
  if (metadata == null) return null;

  const issueNumber = toOptionalPositiveInteger(metadata.issue_number);
  const prNumber = toOptionalPositiveInteger(metadata.pr_number);
  const runId = toOptionalPositiveInteger(metadata.run_id);
  const commitId = toOptionalTrimmedString(metadata.commit_id);
  const isPr =
    metadata.is_pr === true ||
    input.sourceType === "pr_review" ||
    input.sourceType === "pr_opened" ||
    input.sourceType === "pr_comment";

  const directCandidates: Array<GithubObservabilityLink | null> = [
    (() => {
      const href = normalizeGithubUrl(metadata.comment_url);
      if (href == null) return null;
      if (isPr) {
        return {
          href,
          label:
            issueNumber == null
              ? "PR comment"
              : `PR comment on #${issueNumber}`,
          kind: "pr_comment",
        };
      }

      return {
        href,
        label:
          issueNumber == null ? "Comment" : `Issue comment on #${issueNumber}`,
        kind: "issue_comment",
      };
    })(),
    (() => {
      const href = normalizeGithubUrl(metadata.pr_url);
      if (href == null) return null;
      return {
        href,
        label: prNumber == null ? "Pull request" : `PR #${prNumber}`,
        kind: "pr",
      };
    })(),
    (() => {
      const href = normalizeGithubUrl(metadata.issue_url);
      if (href == null) return null;
      return {
        href,
        label: issueNumber == null ? "Issue" : `Issue #${issueNumber}`,
        kind: "issue",
      };
    })(),
    (() => {
      const href = normalizeGithubUrl(metadata.compare_url);
      return href
        ? { href, label: "Push comparison", kind: "compare" as const }
        : null;
    })(),
    (() => {
      const href = normalizeGithubUrl(metadata.details_url);
      return href ? { href, label: "Check run", kind: "check" as const } : null;
    })(),
    (() => {
      const href = normalizeGithubUrl(metadata.html_url);
      if (href == null) return null;
      return {
        href,
        label: runId == null ? "Workflow run" : `Workflow run #${runId}`,
        kind: "run",
      };
    })(),
  ];

  const directLink = directCandidates.find(
    (candidate): candidate is GithubObservabilityLink => candidate != null
  );
  if (directLink) return directLink;

  return {
    issueNumber,
    prNumber,
    commitId,
    isPr,
  };
}

export function resolveGithubObservabilityLink(input: {
  sourceType?: string | null;
  repoFullName?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  const sourceType = toOptionalTrimmedString(input.sourceType);
  const metadata =
    input.metadata &&
    typeof input.metadata === "object" &&
    !Array.isArray(input.metadata)
      ? input.metadata
      : null;
  const metadataLink = buildGithubMetadataLink({
    sourceType,
    metadata,
  });

  if (metadataLink && "href" in metadataLink) {
    return metadataLink;
  }

  const repoFullName =
    normalizeRepoFullName(input.repoFullName) ??
    normalizeRepoFullName(metadata?.repo_full_name);
  if (repoFullName == null) return null;

  const prNumber = metadataLink?.prNumber ?? null;
  const issueNumber = metadataLink?.issueNumber ?? null;
  const commitId = metadataLink?.commitId ?? null;
  const isPr = metadataLink?.isPr === true;

  if (prNumber != null) {
    return {
      href: `https://github.com/${repoFullName}/pull/${prNumber}`,
      label: `PR #${prNumber}`,
      kind: "pr",
    } satisfies GithubObservabilityLink;
  }

  if (issueNumber != null) {
    if (isPr) {
      return {
        href: `https://github.com/${repoFullName}/pull/${issueNumber}`,
        label: `PR #${issueNumber}`,
        kind: "pr",
      } satisfies GithubObservabilityLink;
    }

    return {
      href: `https://github.com/${repoFullName}/issues/${issueNumber}`,
      label: `Issue #${issueNumber}`,
      kind: "issue",
    } satisfies GithubObservabilityLink;
  }

  if (commitId != null) {
    return {
      href: `https://github.com/${repoFullName}/commit/${commitId}`,
      label: `Commit ${commitId.slice(0, 7)}`,
      kind: "commit",
    } satisfies GithubObservabilityLink;
  }

  return null;
}

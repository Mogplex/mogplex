import type { FlowRunRecord } from "@/lib/types";
import { isRecord, toOptionalTrimmedString } from "./run-presentation-parsing";

export type ReviewedTargetLink = {
  href: string;
  label: string;
};

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

export function resolveReviewFindingIssueLink(
  issueUrl: string | null | undefined
) {
  const trimmed = toOptionalTrimmedString(issueUrl);
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    const normalizedPath = parsed.pathname.replace(/\/+$/, "");

    if (parsed.protocol !== "https:" || parsed.hostname !== "github.com") {
      return null;
    }

    if (!/^\/[\w.-]+\/[\w.-]+\/issues\/\d+$/.test(normalizedPath)) {
      return null;
    }

    // Reconstruct canonical form to strip query strings, fragments, and any
    // encoding the regex did not see. Do not simplify to `return trimmed`.
    return `https://github.com${normalizedPath}`;
  } catch {
    return null;
  }
}

// Defense-in-depth: tool-call outputs are persisted opaquely, so a buggy or
// malicious upstream could land anything in `commitUrl` (including
// `javascript:` URLs). Mirror `resolveReviewFindingIssueLink` and only allow
// canonical GitHub commit URLs through to the rendered <a href>.
export function resolveCommitUrl(commitUrl: string | null | undefined) {
  const trimmed = toOptionalTrimmedString(commitUrl);
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    const normalizedPath = parsed.pathname.replace(/\/+$/, "");

    if (parsed.protocol !== "https:" || parsed.hostname !== "github.com") {
      return null;
    }

    if (!/^\/[\w.-]+\/[\w.-]+\/commit\/[a-f0-9]{7,64}$/i.test(normalizedPath)) {
      return null;
    }

    // Reconstruct canonical form to strip query strings, fragments, and any
    // encoding the regex did not see.
    return `https://github.com${normalizedPath}`;
  } catch {
    return null;
  }
}

const COMMIT_SHA_PATTERN = /^[a-f0-9]{7,64}$/i;

function toOptionalCommitSha(value: unknown) {
  const trimmed = toOptionalTrimmedString(value);
  if (!trimmed) return null;
  return COMMIT_SHA_PATTERN.test(trimmed) ? trimmed : null;
}

function resolveCanonicalPullRequestLink(value: unknown) {
  const trimmed = toOptionalTrimmedString(value);
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    const normalizedPath = parsed.pathname.replace(/\/+$/, "");
    const match = normalizedPath.match(
      /^\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)\/pull\/(\d+)$/
    );
    const prNumber = toOptionalPositiveInteger(match?.[3]);

    if (
      parsed.protocol !== "https:" ||
      parsed.hostname !== "github.com" ||
      !match ||
      prNumber == null
    ) {
      return null;
    }

    return {
      href: `https://github.com/${match[1]}/${match[2]}/pull/${prNumber}`,
      label: `PR #${prNumber}`,
    } satisfies ReviewedTargetLink;
  } catch {
    return null;
  }
}

export function resolveReviewedTargetLink(
  run: Pick<FlowRunRecord, "repo" | "metadata"> | null
): ReviewedTargetLink | null {
  if (!run) return null;
  const metadata = isRecord(run.metadata) ? run.metadata : null;
  const canonicalPrLink = resolveCanonicalPullRequestLink(metadata?.pr_url);
  if (canonicalPrLink) return canonicalPrLink;

  const repoFullName = toOptionalTrimmedString(run.repo?.full_name);
  if (
    !repoFullName ||
    !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repoFullName)
  ) {
    return null;
  }

  const prNumber = toOptionalPositiveInteger(metadata?.pr_number);
  if (prNumber != null) {
    return {
      href: `https://github.com/${repoFullName}/pull/${prNumber}`,
      label: `PR #${prNumber}`,
    } satisfies ReviewedTargetLink;
  }

  const issueNumber = toOptionalPositiveInteger(metadata?.issue_number);
  if (issueNumber != null) {
    // GitHub PR comments come in via the issue_comment webhook with
    // `is_pr: true` and the PR number stored in `issue_number`. Route those to
    // the pull request URL so the link points at the conversation the user
    // actually saw.
    if (metadata?.is_pr === true) {
      return {
        href: `https://github.com/${repoFullName}/pull/${issueNumber}`,
        label: `PR #${issueNumber}`,
      } satisfies ReviewedTargetLink;
    }
    return {
      href: `https://github.com/${repoFullName}/issues/${issueNumber}`,
      label: `Issue #${issueNumber}`,
    } satisfies ReviewedTargetLink;
  }

  const commitSha =
    toOptionalCommitSha(metadata?.head_sha) ??
    toOptionalCommitSha(metadata?.commit_id);
  if (commitSha) {
    return {
      href: `https://github.com/${repoFullName}/commit/${commitSha}`,
      label: `Commit ${commitSha.slice(0, 7)}`,
    } satisfies ReviewedTargetLink;
  }

  return null;
}

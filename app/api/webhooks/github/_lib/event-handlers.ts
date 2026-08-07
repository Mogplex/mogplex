import { isMogplexPrReviewCheckName } from "@/lib/github-check-runs";
import { BOT_LOGIN, type EventResult } from "./types";
import {
  handleIssueComment,
  handlePRReviewComment,
  handleCommitComment,
} from "./comment-handlers";

// Re-export comment handlers
export {
  handleIssueComment,
  handlePRReviewComment,
  handleCommitComment,
} from "./comment-handlers";

function isPullRequestTriggerAction(action: string) {
  return ["opened", "synchronize", "ready_for_review", "reopened"].includes(
    action
  );
}

function isBotSynchronizePullRequest(
  body: Record<string, unknown>,
  action: string
) {
  const sender = body.sender as { login?: string; type?: string } | undefined;
  return (
    action === "synchronize" &&
    (sender?.type === "Bot" || sender?.login === BOT_LOGIN)
  );
}

function shouldSkipDraftPullRequest(
  pr:
    | {
        draft?: boolean;
      }
    | undefined,
  action: string
) {
  return Boolean(pr?.draft && action !== "ready_for_review");
}

function buildPullRequestHeadMetadata(pr: {
  head?: { ref?: string; sha?: string; repo?: { full_name?: string } };
}) {
  return {
    head_ref: pr.head?.ref ?? null,
    head_sha: pr.head?.sha ?? null,
    head_repo_full_name: pr.head?.repo?.full_name ?? null,
  };
}

function buildPullRequestBaseMetadata(pr: {
  base?: { ref?: string; sha?: string; repo?: { full_name?: string } };
}) {
  return {
    base_ref: pr.base?.ref ?? null,
    base_sha: pr.base?.sha ?? null,
    base_repo_full_name: pr.base?.repo?.full_name ?? null,
  };
}

function buildPullRequestMetadata(pr: {
  number: number;
  html_url: string;
  title?: string;
  user?: { login?: string; type?: string };
  head?: { ref?: string; sha?: string; repo?: { full_name?: string } };
  base?: { ref?: string; sha?: string; repo?: { full_name?: string } };
}) {
  return {
    pr_number: pr.number,
    pr_url: pr.html_url,
    pr_title: pr.title ?? null,
    pr_author: pr.user?.login ?? null,
    ...buildPullRequestHeadMetadata(pr),
    ...buildPullRequestBaseMetadata(pr),
  };
}

// Emits the `labeled` trigger result for `pull_request.labeled` and
// `issues.labeled` deliveries. Deliberately skips the draft/bot-synchronize
// guards used by the PR lifecycle actions: applying a label is an explicit
// request, so labeling a draft PR still fires. The one sender we skip is our
// own GitHub App - a flow whose agent applies labels with the installation
// token must not re-trigger label flows in a loop. (Third-party bots like
// dependabot remain valid senders: "labeled: dependencies" is a real use
// case.)
export function handleLabeledAction(
  body: Record<string, unknown>,
  isPullRequest: boolean
): EventResult[] {
  const labelRecord =
    body.label && typeof body.label === "object"
      ? (body.label as Record<string, unknown>)
      : null;
  const labelName =
    typeof labelRecord?.name === "string" ? labelRecord.name : null;
  if (!labelName) return [];

  const sender = body.sender as { login?: string; type?: string } | undefined;
  if (sender?.login === BOT_LOGIN) return [];

  if (isPullRequest) {
    const pr = body.pull_request as {
      number: number;
      html_url: string;
      title?: string;
      user?: { login?: string; type?: string };
      head?: { ref?: string; sha?: string; repo?: { full_name?: string } };
      base?: { ref?: string; sha?: string; repo?: { full_name?: string } };
    };
    return [
      {
        assignmentType: "labeled",
        triggerEvent: "labeled",
        metadata: {
          ...buildPullRequestMetadata(pr),
          // PR labels also populate the issue_* fields so downstream comment
          // and thread tooling resolves the target the same way it does for
          // `issue_comment` deliveries (`is_pr` + `issue_number`).
          issue_number: pr.number,
          issue_title: pr.title ?? null,
          issue_url: pr.html_url,
          is_pr: true,
          label_name: labelName,
          sender_login: sender?.login ?? null,
        },
        authorLogin: sender?.login ?? null,
        authorIsBot: sender?.type === "Bot",
      },
    ];
  }

  const issue = body.issue as {
    number: number;
    html_url: string;
    title: string;
  };
  return [
    {
      assignmentType: "labeled",
      triggerEvent: "labeled",
      metadata: {
        issue_number: issue.number,
        issue_url: issue.html_url,
        issue_title: issue.title,
        is_pr: false,
        label_name: labelName,
        sender_login: sender?.login ?? null,
      },
      authorLogin: sender?.login ?? null,
      authorIsBot: sender?.type === "Bot",
    },
  ];
}

export function handlePullRequest(
  body: Record<string, unknown>
): EventResult[] {
  const action = body.action as string;
  if (action === "labeled") {
    return handleLabeledAction(body, true);
  }
  if (!isPullRequestTriggerAction(action)) {
    return [];
  }

  if (isBotSynchronizePullRequest(body, action)) {
    return [];
  }

  const pr = body.pull_request as {
    number: number;
    html_url: string;
    title?: string;
    draft?: boolean;
    user?: { login?: string; type?: string };
    head?: { ref?: string; sha?: string; repo?: { full_name?: string } };
    base?: { ref?: string; sha?: string; repo?: { full_name?: string } };
  };
  if (shouldSkipDraftPullRequest(pr, action)) {
    return [];
  }

  return [
    {
      assignmentType: "pr_review",
      triggerEvent: "pr_opened",
      metadata: buildPullRequestMetadata(pr),
      authorLogin: pr.user?.login ?? null,
      authorIsBot: pr.user?.type === "Bot",
    },
  ];
}

// Tag pushes start `tag_push` flows. Deleted tags are skipped (removing a tag
// is not a release signal), and our own GitHub App sender is skipped for
// parity with the labeled trigger's loop guard. Tags created through the
// releases UI/API also arrive as push deliveries for the tag ref, so this
// covers both `git push --tags` and published releases.
export function handleTagPush(
  body: Record<string, unknown>,
  ref: string
): EventResult[] {
  if (body.deleted === true) return [];

  const tagName = ref.slice("refs/tags/".length);
  if (!tagName) return [];

  const sender = body.sender as { login?: string; type?: string } | undefined;
  if (sender?.login === BOT_LOGIN) return [];

  const headCommit = body.head_commit as { id: string } | null;

  return [
    {
      assignmentType: "tag_push",
      triggerEvent: "tag_push",
      metadata: {
        tag_name: tagName,
        ref,
        head_sha: headCommit?.id ?? (body.after as string),
        compare_url: body.compare as string,
        sender_login: sender?.login ?? null,
      },
      authorLogin: sender?.login ?? null,
      authorIsBot: sender?.type === "Bot",
    },
  ];
}

function handlePush(body: Record<string, unknown>): EventResult[] {
  const ref = body.ref as string;
  if (typeof ref === "string" && ref.startsWith("refs/tags/")) {
    return handleTagPush(body, ref);
  }

  const defaultRef = `refs/heads/${(body.repository as { default_branch: string }).default_branch}`;
  if (ref !== defaultRef) return [];

  const commits = body.commits as unknown[];
  const headCommit = body.head_commit as { id: string } | null;

  return [
    {
      assignmentType: "push_review",
      triggerEvent: "push",
      metadata: {
        head_sha: headCommit?.id ?? (body.after as string),
        commits_count: commits?.length ?? 0,
        compare_url: body.compare as string,
      },
    },
  ];
}

function handleIssues(body: Record<string, unknown>): EventResult[] {
  const action = body.action as string;
  if (action === "labeled") {
    return handleLabeledAction(body, false);
  }
  if (!["opened", "reopened"].includes(action)) return [];

  const issue = body.issue as {
    number: number;
    html_url: string;
    title: string;
  };
  return [
    {
      assignmentType: "issue_triage",
      triggerEvent: "issue_opened",
      metadata: {
        issue_number: issue.number,
        issue_url: issue.html_url,
        issue_title: issue.title,
      },
    },
  ];
}

export function handleCIEvent(
  event: string,
  body: Record<string, unknown>
): EventResult[] {
  if (event === "check_run") {
    const checkRun = body.check_run as {
      conclusion: string | null;
      name: string;
      head_sha: string;
      details_url: string;
      check_suite?: { head_branch?: string | null };
    };
    if (isMogplexPrReviewCheckName(checkRun.name)) return [];
    if (body.action !== "completed" || checkRun.conclusion !== "failure")
      return [];

    return [
      {
        assignmentType: "ci_failure",
        triggerEvent: "ci_failure",
        metadata: {
          check_name: checkRun.name,
          head_sha: checkRun.head_sha,
          details_url: checkRun.details_url,
          // The branch the failing commit was pushed to. Reverts must target
          // this branch, not the repo default - CI failures fire for any ref.
          head_branch: checkRun.check_suite?.head_branch ?? null,
        },
      },
    ];
  }

  if (event === "workflow_run") {
    const run = body.workflow_run as {
      conclusion: string | null;
      name: string;
      head_sha: string;
      html_url: string;
      id: number;
      head_branch?: string | null;
    };
    if (body.action !== "completed" || run.conclusion !== "failure") return [];

    return [
      {
        assignmentType: "ci_failure",
        triggerEvent: "ci_failure",
        metadata: {
          workflow_name: run.name,
          head_sha: run.head_sha,
          html_url: run.html_url,
          run_id: run.id,
          head_branch: run.head_branch ?? null,
        },
      },
    ];
  }

  return [];
}

const eventHandlers: Record<
  string,
  (body: Record<string, unknown>, event: string) => EventResult[]
> = {
  pull_request: (body) => handlePullRequest(body),
  push: (body) => handlePush(body),
  issues: (body) => handleIssues(body),
  check_run: (body, event) => handleCIEvent(event, body),
  workflow_run: (body, event) => handleCIEvent(event, body),
  issue_comment: (body) => handleIssueComment(body),
  pull_request_review_comment: (body) => handlePRReviewComment(body),
  commit_comment: (body) => handleCommitComment(body),
};

export function getWebhookEventResults(
  event: string | null,
  body: Record<string, unknown>
) {
  const handler = event ? eventHandlers[event] : null;
  if (!handler || !event) {
    return [];
  }

  return handler(body, event);
}

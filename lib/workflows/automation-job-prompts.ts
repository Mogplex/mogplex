/**
 * Prompt building functions for the automation job workflow.
 * Extracted from automation-job-workflow.ts for modularity.
 */

import { buildPrReviewRunSpec } from "@/lib/agents/pr-review-run-spec";
import type { HarnessId } from "@/lib/harness/config";
import type { ReviewOutcome } from "@/lib/workflows/pr-review-harness";
import type {
  JobContext,
  PullRequestDetails,
} from "@/lib/workflows/automation-job-types";
import {
  normalizeAutomationAssignmentType,
  isRecord,
  toOptionalString,
  toStringArray,
  toReviewFindings,
} from "@/lib/workflows/automation-job-utils";
import { isFlowAgentNodeRole } from "@/lib/flows/graph";

const AUTOMATION_HARNESS_REVIEW_PREFIX = "MOGPLEX_REVIEW_RESULT:";

export function buildPromptForJob(
  type: string,
  metadata: Record<string, unknown>,
  systemPrompt: string | null
): {
  prompt: string;
  system?: string;
} {
  const normalizedType = normalizeAutomationAssignmentType(type);
  const flowPreviousOutputs = Array.isArray(metadata.flow_previous_outputs)
    ? metadata.flow_previous_outputs
        .filter(
          (entry): entry is { label?: unknown; output?: unknown } =>
            typeof entry === "object" && entry !== null
        )
        .map((entry) => {
          const label =
            typeof entry.label === "string" ? entry.label : "Previous step";
          const output = typeof entry.output === "string" ? entry.output : "";
          return { label, output };
        })
        .filter((entry) => entry.output.trim().length > 0)
    : [];
  const flowContextBlock =
    flowPreviousOutputs.length > 0
      ? [
          "Upstream flow context:",
          ...flowPreviousOutputs.map(
            (entry, index) => `${index + 1}. ${entry.label}: ${entry.output}`
          ),
        ].join("\n")
      : null;

  if (normalizedType === "cron_refactor" || normalizedType === "cron") {
    return {
      system: systemPrompt || "You are a code refactoring agent.",
      prompt: [
        `Use the GitHub tools to improve ${String(metadata.repo_full_name || "the repository")} on a new branch from ${String(metadata.base_branch || "main")}.`,
        typeof metadata.skill_id === "string" && metadata.skill_id
          ? `Start by fetching the skill definition for "${metadata.skill_id}" and follow it.`
          : "Perform a focused, low-risk refactor with clear value.",
        flowContextBlock,
        "You must inspect relevant files, create a branch, apply edits, and create a pull request back to the base branch if you make a meaningful change.",
        "If the repository does not need a safe automated refactor, explain why and do not create a PR.",
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  if (normalizedType === "pr_review") {
    // Separate stable cacheable content (system) from per-call content (prompt)
    // so Anthropic prompt caching can fire. See issue #530.
    return buildPrReviewRunSpec({
      flowContextBlock,
      prNumber: metadata.pr_number,
      systemPrompt,
      lifecycleTools: metadata.flow_auto_merge === true,
    });
  }

  const prefix = systemPrompt ? `${systemPrompt}\n\n` : "";
  const promptPrefix = flowContextBlock
    ? `${prefix}${flowContextBlock}\n\n`
    : prefix;

  switch (normalizedType) {
    case "webhook": {
      const webhookPayload =
        metadata.webhook &&
        typeof metadata.webhook === "object" &&
        !Array.isArray(metadata.webhook)
          ? (metadata.webhook as Record<string, unknown>)
          : {};
      const webhookPrompt =
        typeof webhookPayload.prompt === "string"
          ? webhookPayload.prompt.trim()
          : "";
      return {
        prompt: [
          promptPrefix,
          webhookPrompt || "Process this signed webhook event.",
          `Webhook payload:\n${JSON.stringify(webhookPayload)}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
      };
    }
    case "push_review":
      return {
        prompt: `${promptPrefix}Review the ${metadata.commits_count} commit(s) pushed. Head SHA: ${metadata.head_sha}. Compare: ${metadata.compare_url}. Focus on security, performance, and correctness. Fetch key changed files and post a review comment.`,
      };
    case "tag_push": {
      const tagBy =
        typeof metadata.sender_login === "string" && metadata.sender_login
          ? ` by @${metadata.sender_login}`
          : "";
      return {
        prompt: `${promptPrefix}Tag "${metadata.tag_name}" was pushed${tagBy}. Compare: ${metadata.compare_url}. Inspect the tagged state with listFiles and fetchFile (both default to the tag ref), then act on your instructions. Post your findings as a commit comment with postCommitComment, or open an issue with createIssue if follow-up work is needed.`,
      };
    }
    case "issue_triage":
      return {
        prompt: `${promptPrefix}Triage issue #${metadata.issue_number}: "${metadata.issue_title}". Fetch the issue details, add appropriate labels, and post an initial response with guidance or next steps.`,
      };
    case "ci_failure": {
      const name = metadata.check_name ?? metadata.workflow_name ?? "unknown";
      const revertHint =
        metadata.flow_auto_revert === true
          ? ` If the pushed commit itself caused the failure and no quick fix is apparent, call createRevertPr to open a revert PR (it only works while that commit is still the branch head).`
          : "";
      return {
        prompt: `${promptPrefix}CI check "${name}" failed on ${metadata.head_sha}. Analyze the failure, fetch relevant source files if needed, and suggest a fix. Post a commit comment with your analysis.${revertHint}`,
      };
    }
    case "mention": {
      const entityType = metadata.is_pr ? "PR" : "issue";
      const entityRef = metadata.issue_number
        ? `#${metadata.issue_number}`
        : `commit ${String(metadata.commit_id || "unknown").slice(0, 7)}`;
      return {
        prompt: `${promptPrefix}You were @mentioned in a ${entityType} comment on ${entityRef} by @${metadata.comment_author}. The comment:\n\n"${metadata.comment_body}"\n\nUse getThreadContext to understand the full conversation, then use replyToThread to respond helpfully.`,
      };
    }
    case "pr_comment":
      return {
        prompt: `${promptPrefix}A new comment was posted on PR #${metadata.issue_number} "${metadata.issue_title}" by @${metadata.comment_author}:\n\n"${metadata.comment_body}"\n\nUse getThreadContext to understand the conversation. Analyze and respond if appropriate using replyToThread.`,
      };
    case "issue_comment":
      return {
        prompt: `${promptPrefix}A new comment was posted on issue #${metadata.issue_number} "${metadata.issue_title}" by @${metadata.comment_author}:\n\n"${metadata.comment_body}"\n\nUse getThreadContext to understand the conversation. Analyze and respond if appropriate using replyToThread.`,
      };
    case "labeled": {
      const labelBy =
        typeof metadata.sender_login === "string" && metadata.sender_login
          ? ` by @${metadata.sender_login}`
          : "";
      const labelTitle = metadata.issue_title
        ? ` "${metadata.issue_title}"`
        : "";
      if (metadata.is_pr === true) {
        return {
          prompt: `${promptPrefix}The "${metadata.label_name}" label was added to PR #${metadata.issue_number}${labelTitle}${labelBy}. Inspect the pull request with getPullRequest and listChangedFiles, read the files you need, then act on your instructions. Call reportReview with structured findings when you perform a review; use postComment for conversational replies.`,
        };
      }
      return {
        prompt: `${promptPrefix}The "${metadata.label_name}" label was added to issue #${metadata.issue_number}${labelTitle}${labelBy}. Fetch the issue with fetchIssue, then act on your instructions — add labels with addLabels or reply with postIssueComment as appropriate.`,
      };
    }
    default:
      return {
        prompt: `${promptPrefix}Process job with metadata: ${JSON.stringify(metadata)}`,
      };
  }
}

export function buildPromptForPRFix(input: {
  context: JobContext;
  review: ReviewOutcome;
  pullRequest: PullRequestDetails;
  targetRepo: JobContext["repo"];
}) {
  const prefix = input.context.agent.system_prompt
    ? `${input.context.agent.system_prompt}\n\n`
    : "";
  return {
    prompt: [
      `${prefix}A prior PR review found issues in PR #${input.pullRequest.number} for ${input.context.repo.full_name}.`,
      input.pullRequest.title
        ? `PR title: "${input.pullRequest.title}".`
        : null,
      `Apply a safe, minimal fix directly to the existing PR branch ${input.pullRequest.headRef} targeting ${input.pullRequest.baseRef}.`,
      input.targetRepo.full_name === input.context.repo.full_name
        ? null
        : `The PR head repository is ${input.targetRepo.full_name}; write changes there, not to the base repository.`,
      input.review.summary ? `Review summary: ${input.review.summary}` : null,
      input.review.commentBody
        ? `The reviewer comment body was:\n${input.review.commentBody}`
        : null,
      // Structured reviews put the line-level detail in findings and omit
      // commentBody, so the fixer prompt must carry the findings itself.
      input.review.findings.length > 0
        ? [
            "The review findings:",
            ...input.review.findings.map((finding) => {
              const location = finding.path
                ? ` (${finding.path}${finding.line === null ? "" : `:${finding.line}`})`
                : "";
              return `- [${finding.severity}] ${finding.title}${location}: ${finding.body}`;
            }),
          ].join("\n")
        : null,
      input.review.affectedFiles.length > 0
        ? `Likely affected files: ${input.review.affectedFiles.join(", ")}.`
        : null,
      "Start by calling getPullRequest and listChangedFiles to confirm context, then read the smallest set of files needed.",
      "Use updateFile to commit changes directly to the PR branch. Do not create a new branch and do not open a new pull request.",
      "If you apply a fix, call reportFix with applied=true and the updated files before finishing.",
      "If no safe automated fix is possible, do not modify files and call reportFix with applied=false and a short explanation.",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

export function buildAutomationHarnessPrompt(input: {
  context: JobContext;
  harnessId: HarnessId;
  review?: ReviewOutcome | null;
  pullRequest?: PullRequestDetails | null;
  targetRepo?: JobContext["repo"] | null;
}) {
  const assignmentType = normalizeAutomationAssignmentType(
    input.context.assignmentType
  );
  const baseBranch = input.context.repo.default_branch || "main";
  const runSpec =
    input.review && input.pullRequest && input.targetRepo
      ? buildPromptForPRFix({
          context: input.context,
          review: input.review,
          pullRequest: input.pullRequest,
          targetRepo: input.targetRepo,
        })
      : buildPromptForJob(
          assignmentType,
          {
            ...input.context.metadata,
            repo_full_name: input.context.repo.full_name,
            base_branch: baseBranch,
            skill_id: input.context.skillId,
          },
          input.context.agent.system_prompt
        );

  const metadataRole = input.context.metadata.flow_node_role;
  const isReview =
    (isFlowAgentNodeRole(metadataRole) ? metadataRole : "review") === "review";

  const instructions = [
    `You are ${input.harnessId === "claude-code" ? "Claude Code" : "Codex"} running a Mogplex automation inside an isolated checkout of ${input.context.repo.full_name}.`,
    "Use the local checkout and the authenticated gh CLI instead of any Mogplex-only tool names mentioned below.",
    "Never print credentials or environment-variable values.",
    "system" in runSpec && runSpec.system
      ? `Agent instructions:\n${runSpec.system}`
      : null,
    `Task:\n${runSpec.prompt}`,
  ];

  if (input.review && input.pullRequest) {
    instructions.push(
      "Apply the smallest safe fix in the current PR branch, run relevant checks, then commit and push the changes to that same branch.",
      "Do not create a new branch or pull request. Do not force-push.",
      "Finish with a concise summary of the files changed and checks run."
    );
  } else if (isReview) {
    instructions.push(
      "Inspect only. Do not edit files, push commits, merge, or publish GitHub comments or reviews; Mogplex publishes the review after you finish.",
      `Your final non-empty line must be ${AUTOMATION_HARNESS_REVIEW_PREFIX} followed by one compact JSON object with this shape: {"hasIssues":true,"summary":"...","commentBody":"...","affectedFiles":["path"],"findings":[{"severity":"warning","title":"...","body":"...","path":"path","line":1}]}.`,
      "Use hasIssues=false and an empty findings array only when there are no material issues."
    );
  } else {
    instructions.push(
      "Complete the task using the local checkout and gh CLI, then finish with a concise outcome summary."
    );
  }

  return instructions.filter(Boolean).join("\n\n");
}

export function parseAutomationHarnessReviewResult(
  text: string
): ReviewOutcome | null {
  const markerIndex = text.lastIndexOf(AUTOMATION_HARNESS_REVIEW_PREFIX);
  if (markerIndex === -1) return null;

  const jsonLine = text
    .slice(markerIndex + AUTOMATION_HARNESS_REVIEW_PREFIX.length)
    .trimStart()
    .split(/\r?\n/, 1)[0]
    ?.trim()
    .replace(/```$/, "");
  if (!jsonLine) return null;

  try {
    const payload = JSON.parse(jsonLine) as unknown;
    if (!isRecord(payload) || typeof payload.hasIssues !== "boolean") {
      return null;
    }
    const summary = toOptionalString(payload.summary);
    if (!summary) return null;
    const findings = toReviewFindings(payload.findings);
    if (payload.hasIssues && findings.length === 0) return null;

    return {
      hasIssues: payload.hasIssues,
      summary,
      commentBody: toOptionalString(payload.commentBody),
      affectedFiles: toStringArray(payload.affectedFiles),
      findings,
    };
  } catch {
    return null;
  }
}

export function stripAutomationHarnessReviewMarker(text: string) {
  const markerIndex = text.lastIndexOf(AUTOMATION_HARNESS_REVIEW_PREFIX);
  return (markerIndex === -1 ? text : text.slice(0, markerIndex)).trim();
}

import { isMogplexAuthoredComment } from "@/lib/github-automation-marker";
import type { TriggerEvent } from "@/lib/types";
import { BOT_LOGIN, type EventResult } from "./types";

export function parseMentions(text: string): {
  hasMention: boolean;
  slugs: string[];
} {
  const mentionRegex = /@mogplex(?:\/([\da-z-]+))?/gi;
  const slugs: string[] = [];
  let hasMention = false;
  let match: RegExpExecArray | null;
  while ((match = mentionRegex.exec(text)) !== null) {
    hasMention = true;
    if (match[1]) slugs.push(match[1]);
  }
  return { hasMention, slugs };
}

export function handleIssueComment(
  body: Record<string, unknown>
): EventResult[] {
  if (body.action !== "created") return [];

  const comment = body.comment as {
    id: number;
    body: string;
    html_url: string;
    user: { login: string; type: string };
  };

  // Self-loop prevention: skip our own output. The `type === "Bot"` / BOT_LOGIN
  // checks catch comments posted as the App. Agent comments are posted with the
  // connected user's token (arriving as a regular `User`), so we also skip any
  // comment carrying our automation marker - otherwise an "@mogplex" the model
  // writes in its reply re-triggers the mention flow. A human typing "@mogplex"
  // has no marker and still triggers normally.
  if (
    comment.user.type === "Bot" ||
    comment.user.login === BOT_LOGIN ||
    isMogplexAuthoredComment(comment.body)
  )
    return [];

  const issue = body.issue as {
    number: number;
    html_url: string;
    title: string;
    pull_request?: unknown;
  };

  const isPr = Boolean(issue.pull_request);
  const { hasMention, slugs } = parseMentions(comment.body || "");

  const commentMeta = {
    comment_id: comment.id,
    comment_body: (comment.body || "").slice(0, 4096),
    comment_url: comment.html_url,
    comment_author: comment.user.login,
    issue_number: issue.number,
    issue_title: issue.title,
    is_pr: isPr,
  };

  if (hasMention) {
    if (slugs.length > 0) {
      return slugs.map((slug) => ({
        assignmentType: "mention",
        triggerEvent: "mention" as TriggerEvent,
        metadata: commentMeta,
        agentSlug: slug,
      }));
    }
    return [
      {
        assignmentType: "mention",
        triggerEvent: "mention" as TriggerEvent,
        metadata: commentMeta,
        agentSlug: null,
      },
    ];
  }

  return [
    {
      assignmentType: isPr ? "pr_comment" : "issue_comment",
      triggerEvent: (isPr ? "pr_comment" : "issue_comment") as TriggerEvent,
      metadata: commentMeta,
    },
  ];
}

export function handlePRReviewComment(
  body: Record<string, unknown>
): EventResult[] {
  if (body.action !== "created") return [];

  const comment = body.comment as {
    id: number;
    body: string;
    html_url: string;
    user: { login: string; type: string };
  };

  // Self-loop prevention - see handleIssueComment for the rationale.
  if (
    comment.user.type === "Bot" ||
    comment.user.login === BOT_LOGIN ||
    isMogplexAuthoredComment(comment.body)
  )
    return [];

  const pr = body.pull_request as {
    number: number;
    html_url: string;
    title: string;
  };
  const { hasMention, slugs } = parseMentions(comment.body || "");

  const commentMeta = {
    comment_id: comment.id,
    comment_body: (comment.body || "").slice(0, 4096),
    comment_url: comment.html_url,
    comment_author: comment.user.login,
    issue_number: pr.number,
    issue_title: pr.title,
    is_pr: true,
  };

  if (hasMention) {
    if (slugs.length > 0) {
      return slugs.map((slug) => ({
        assignmentType: "mention",
        triggerEvent: "mention" as TriggerEvent,
        metadata: commentMeta,
        agentSlug: slug,
      }));
    }
    return [
      {
        assignmentType: "mention",
        triggerEvent: "mention" as TriggerEvent,
        metadata: commentMeta,
        agentSlug: null,
      },
    ];
  }

  return [
    {
      assignmentType: "pr_comment",
      triggerEvent: "pr_comment" as TriggerEvent,
      metadata: commentMeta,
    },
  ];
}

export function handleCommitComment(
  body: Record<string, unknown>
): EventResult[] {
  if (body.action !== "created") return [];

  const comment = body.comment as {
    id: number;
    body: string;
    html_url: string;
    user: { login: string; type: string };
    commit_id: string;
  };

  // Self-loop prevention - see handleIssueComment. `ci-tools` posts commit
  // comments with the connected user's token (arriving as a `User`), so the
  // marker check is required here too, not just the Bot guard.
  if (
    comment.user.type === "Bot" ||
    comment.user.login === BOT_LOGIN ||
    isMogplexAuthoredComment(comment.body)
  )
    return [];

  const { hasMention, slugs } = parseMentions(comment.body || "");

  const commentMeta = {
    comment_id: comment.id,
    comment_body: (comment.body || "").slice(0, 4096),
    comment_url: comment.html_url,
    comment_author: comment.user.login,
    commit_id: comment.commit_id,
    is_pr: false,
  };

  if (hasMention) {
    if (slugs.length > 0) {
      return slugs.map((slug) => ({
        assignmentType: "mention",
        triggerEvent: "mention" as TriggerEvent,
        metadata: commentMeta,
        agentSlug: slug,
      }));
    }
    return [
      {
        assignmentType: "mention",
        triggerEvent: "mention" as TriggerEvent,
        metadata: commentMeta,
        agentSlug: null,
      },
    ];
  }

  // Commit comments without mentions don't map to a standard trigger
  return [];
}

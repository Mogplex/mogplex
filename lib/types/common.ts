/**
 * Common types shared across multiple domains.
 */

export type TriggerEvent =
  | "mention"
  | "pr_opened"
  | "issue_opened"
  | "pr_comment"
  | "issue_comment"
  | "push"
  | "ci_failure"
  | "labeled"
  | "tag_push"
  | "schedule"
  | "webhook"
  | "slack_mention";

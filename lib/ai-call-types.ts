export const AI_CALL_TYPES = [
  "chat",
  "pr_review",
  "cron_refactor",
  "cron",
  "agent",
  "push_review",
  "issue_triage",
  "ci_failure",
  "mention",
  "pr_comment",
  "issue_comment",
  "labeled",
  "tag_push",
] as const;

export type AiCallType = (typeof AI_CALL_TYPES)[number];

export const AI_CALL_TYPE_SET = new Set<string>(AI_CALL_TYPES);

export function isAiCallType(value: string): value is AiCallType {
  return AI_CALL_TYPE_SET.has(value);
}

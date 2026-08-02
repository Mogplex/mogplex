import type { HarnessId } from "@/lib/harness/config";

const RECOVERABLE_RESUME_ERROR_PATTERNS: Record<HarnessId, RegExp[]> = {
  "claude-code": [
    /\bno conversation found with session id\b/i,
    /\bresume\b[\S\s]*\b(not found|invalid|unknown|expired|failed|unable|missing)\b/i,
    /\bsession\b[\S\s]*\b(not found|invalid|unknown|expired|failed|unable|missing)\b/i,
    /\b(could not|unable to|failed to)\b[\S\s]*\bresume\b/i,
  ],
  codex: [
    /\bno rollout found for thread id\b/i,
    /\bresume\b[\S\s]*\b(not found|invalid|unknown|expired|failed|unable|missing)\b/i,
    /\b(session|thread)\b[\S\s]*\b(not found|invalid|unknown|expired|failed|unable|missing)\b/i,
    /\b(could not|unable to|failed to)\b[\S\s]*\b(resume|session|thread)\b/i,
  ],
};

export function isRecoverableHarnessResumeFailure(
  harnessId: HarnessId,
  message: string | null | undefined
) {
  if (!message?.trim()) return false;

  return RECOVERABLE_RESUME_ERROR_PATTERNS[harnessId].some((pattern) =>
    pattern.test(message)
  );
}

export function buildHarnessResumeRetryNotice(harnessId: HarnessId) {
  return harnessId === "claude-code"
    ? "[previous Claude Code session unavailable; starting fresh]"
    : "[previous harness session unavailable; starting fresh]";
}

import { timeout } from "@trigger.dev/sdk/v3";

/**
 * Workers that hold an agent conversation (external runs, their resumes, and
 * Control continuations) end on completion, cancellation, or an error, never
 * on elapsed time. A 30-minute cap killed a Slack run mid-way through its
 * test and coverage steps, before it could push, and lost its work. A worker
 * that stalls is found by the zombie reaper once it records no progress for
 * its idle window, and stopped. Supervisors keep a cap because a checkpointed
 * wait consumes none of it.
 */
export const AGENT_WORKER_MAX_DURATION_SECONDS = timeout.None;

/**
 * Options every agent-conversation worker shares, so their duration and
 * single attempt can't drift apart task by task.
 */
export const AGENT_WORKER_TASK_OPTIONS = {
  maxDuration: AGENT_WORKER_MAX_DURATION_SECONDS,
  retry: { maxAttempts: 1 },
} as const;

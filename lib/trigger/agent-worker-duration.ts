import { timeout } from "@trigger.dev/sdk/v3";

/**
 * Workers that hold an agent conversation (external runs, their resumes, and
 * Control continuations) end on completion, cancellation, or an error, never
 * on elapsed time. A 30-minute cap killed a Slack run mid-way through its
 * test and coverage steps, before it could push, and lost its work. Provider
 * requests stay bounded on their own; their supervisors keep a cap because a
 * checkpointed wait consumes none of it.
 */
export const AGENT_WORKER_MAX_DURATION_SECONDS = timeout.None;

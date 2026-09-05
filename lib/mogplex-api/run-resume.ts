/**
 * Resumes a run that paused at a checkpoint (status `awaiting_input`), given
 * the user's steering reply.
 *
 * Production sandboxes are non-persistent: after the idle window the reaper
 * hard-stops the VM and Vercel discards its filesystem, so a paused run cannot
 * be woken in place. Instead the checkpoint protocol requires the agent to
 * commit and push its work before pausing, and a resume runs a fresh *segment*:
 *
 *   1. Create a new pending ai_call and repoint the run at it. Each segment is
 *      billed on its own ai_call row; the run's `ai_call_id` always names the
 *      latest segment (latest-segment cost rollup).
 *   2. Launch a fresh sandbox from the committed working branch
 *      (`create_branch: false` checks out `working_branch`, which carries the
 *      checkpoint commits). Stale sandbox refs are cleared so the launch route
 *      is actually called rather than short-circuiting on the dead sandbox.
 *   3. Run the harness once with a continue-prompt (the user's steer plus the
 *      checkpoint protocol), then finalize exactly like an initial pass: pause
 *      again at the next checkpoint, ship the PR on approval, or fail.
 *
 * Dormant until the checkpoint protocol is activated on the initial prompt: no
 * run reaches `awaiting_input` until then, so `resumeExternalAgentRun` has
 * nothing to resume.
 */
import { buildCheckpointProtocolInstructions } from "@/lib/harness/checkpoint";
import {
  createAiCall,
  loadOwnedAiCall,
  safeAppendAiCallEvent,
} from "@/lib/interactive-runs";
import {
  launchSandboxViaRoute,
  type SandboxRef,
} from "@/lib/mogplex-api/run-execution-launch";
import {
  loadRunForExecution,
  updateExternalAgentRun,
} from "@/lib/mogplex-api/run-execution-data";
import {
  runHarnessViaRoute,
  type ExternalAgentRunExecutionResult,
} from "@/lib/mogplex-api/run-execution";
import {
  finalizeFailedPass,
  finalizeHarnessPass,
  type FinalizeDeps,
} from "@/lib/mogplex-api/run-execution-finalize";
import { notifySlackRunCheckpoint } from "@/lib/slack/run-checkpoint-notify";
import { notifyTerminalSlackRunOnce } from "./run-terminal-notification";
import { isTriggerRuntimeConfigured } from "@/lib/runtime-providers";
import { TRIGGER_TASK_IDS } from "@/lib/trigger/task-ids";
import type { ExternalAgentRunRow } from "@/lib/mogplex-api/runs";

export type ResumeExternalAgentRunPayload = {
  runId: string;
  userId: string;
  /** The user's steering reply that triggered this resume. */
  steer: string;
};

/**
 * Queues a resume segment on Trigger. A resume can't run inline in the Slack
 * event task (a segment can take many minutes), so the Slack reply handler
 * dispatches it here. Resumes of the same run share a concurrency key so they
 * serialize; the caller owns idempotency (e.g. keyed on the Slack message ts).
 */
type TriggerHandle = { id?: string | null };
type TriggerResumeTask = (
  taskId: string,
  payload: ResumeExternalAgentRunPayload,
  options: Record<string, unknown>
) => Promise<TriggerHandle>;

type QueueResumeDeps = {
  isRuntimeConfigured: () => boolean;
  triggerTask: TriggerResumeTask;
};

async function defaultTriggerResumeTask(
  taskId: string,
  payload: ResumeExternalAgentRunPayload,
  options: Record<string, unknown>
): Promise<TriggerHandle> {
  const { tasks } = await import("@trigger.dev/sdk/v3");
  return tasks.trigger(taskId, payload, options);
}

export async function queueResumeExternalAgentRun(
  input: {
    runId: string;
    userId: string;
    repoId: string;
    steer: string;
    idempotencyKey: string;
  },
  overrides: Partial<QueueResumeDeps> = {}
): Promise<{ runtimeProvider: "trigger"; runtimeRunId: string | null }> {
  const deps: QueueResumeDeps = {
    isRuntimeConfigured: isTriggerRuntimeConfigured,
    triggerTask: defaultTriggerResumeTask,
    ...overrides,
  };

  if (!deps.isRuntimeConfigured()) {
    throw new Error("Trigger.dev runtime is not configured");
  }

  const handle = await deps.triggerTask(
    TRIGGER_TASK_IDS.resumeAgentRun,
    {
      runId: input.runId,
      userId: input.userId,
      steer: input.steer,
    },
    {
      idempotencyKey: input.idempotencyKey,
      concurrencyKey: `resume-agent-run:${input.runId}`,
      maxAttempts: 1,
      tags: [
        `user:${input.userId}`,
        `repo:${input.repoId}`,
        `external-run:${input.runId}`,
      ],
      metadata: {
        runId: input.runId,
        userId: input.userId,
        repoId: input.repoId,
      },
    }
  );

  return {
    runtimeProvider: "trigger",
    runtimeRunId: handle.id ?? null,
  };
}

type ResumeExternalAgentRunDeps = FinalizeDeps & {
  loadRun: (
    runId: string,
    userId: string
  ) => Promise<ExternalAgentRunRow | null>;
  createAiCall: typeof createAiCall;
  launchSandbox: (run: ExternalAgentRunRow) => Promise<SandboxRef>;
  runHarness: (
    run: ExternalAgentRunRow,
    sandbox: SandboxRef
  ) => Promise<{ output: string }>;
};

const defaultResumeDeps: ResumeExternalAgentRunDeps = {
  loadRun: loadRunForExecution,
  updateRun: updateExternalAgentRun,
  createAiCall,
  launchSandbox: launchSandboxViaRoute,
  runHarness: runHarnessViaRoute,
  loadAiCall: loadOwnedAiCall,
  appendEvent: safeAppendAiCallEvent,
  notifyRunReachedTerminalState: notifyTerminalSlackRunOnce,
  notifyRunCheckpoint: notifySlackRunCheckpoint,
};

/**
 * The prompt for a resumed segment: reconcile the fresh checkout against the
 * pushed branch, apply the user's steer, then follow the checkpoint protocol
 * (pause again or ship on approval).
 */
export function buildResumeContinuePrompt(
  run: ExternalAgentRunRow,
  steer: string
): string {
  const trimmedSteer = steer.trim();
  return [
    `You are resuming a paused repo-agent run in a FRESH checkout of branch \`${run.working_branch}\`.`,
    "Your earlier work was committed and pushed to that branch before the run paused.",
    "First reconcile your working tree: run `git fetch origin` and `git log --oneline -5`, and confirm your previous checkpoint commit(s) are present on this branch. If your prior work is missing, STOP and report that the checkpoint was lost instead of silently redoing it.",
    "",
    "The user reviewed your last checkpoint and replied:",
    trimmedSteer || "(no additional instructions — proceed)",
    "",
    buildCheckpointProtocolInstructions(),
  ].join("\n");
}

/**
 * Runs one resume segment for a paused run. Returns a not-found or conflict
 * result without side effects when the run cannot be resumed.
 */
export async function resumeExternalAgentRun(
  payload: ResumeExternalAgentRunPayload,
  overrides: Partial<ResumeExternalAgentRunDeps> = {}
): Promise<ExternalAgentRunExecutionResult> {
  const deps: ResumeExternalAgentRunDeps = {
    ...defaultResumeDeps,
    ...overrides,
  };

  const run = await deps.loadRun(payload.runId, payload.userId);
  if (!run) {
    return {
      success: false,
      runId: payload.runId,
      status: "not_found",
      error: "External agent run not found",
    };
  }

  if (run.status !== "awaiting_input") {
    // Only a run paused at a checkpoint can be resumed. A duplicate reply or a
    // race that already advanced the run lands here and is a no-op.
    return {
      success: false,
      runId: run.id,
      status: run.status,
      error: `Run is ${run.status}, not awaiting input`,
    };
  }

  // New segment: its own pending ai_call, pinned to external-api so the harness
  // route accepts it as a claim. Reusing the run's metadata preserves the
  // origin/repo labels; source is re-pinned defensively.
  const segmentAiCall = await deps.createAiCall({
    userId: run.user_id,
    type: "agent",
    model: `harness:${run.harness}`,
    conversationId: run.conversation_id,
    repoId: run.repo_id,
    status: "pending",
    metadata: {
      ...run.metadata,
      source: "external-api",
      resumed_from_ai_call_id: run.ai_call_id,
      run_segment: "resume",
    },
  });

  // Repoint the run at the new segment and clear the dead sandbox so the launch
  // route runs a fresh checkout instead of short-circuiting on stale refs.
  const repointed = await deps.updateRun(run.user_id, run.id, {
    ai_call_id: segmentAiCall.id,
    sandbox_record_id: null,
    sandbox_id: null,
    status: "streaming",
    error: null,
  });

  const segmentRun: ExternalAgentRunRow = {
    ...repointed,
    create_branch: false,
    prompt: buildResumeContinuePrompt(run, payload.steer),
  };

  try {
    const sandbox = await deps.launchSandbox(segmentRun);
    const running = await deps.updateRun(run.user_id, run.id, {
      sandbox_record_id: sandbox.recordId,
      sandbox_id: sandbox.sandboxId,
      status: "streaming",
      error: null,
    });
    const runForHarness: ExternalAgentRunRow = {
      ...running,
      create_branch: false,
      prompt: segmentRun.prompt,
    };
    const harnessResult = await deps.runHarness(runForHarness, sandbox);
    return await finalizeHarnessPass(runForHarness, harnessResult, deps);
  } catch (error) {
    return await finalizeFailedPass(segmentRun, error, deps);
  }
}

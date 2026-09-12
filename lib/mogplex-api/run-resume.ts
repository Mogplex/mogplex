/** Resume a checkpoint in its saved workspace, preserving uncommitted files. */
import { buildCheckpointProtocolInstructions } from "@/lib/harness/checkpoint";
import {
  createAiCall,
  loadOwnedAiCall,
  safeAppendAiCallEvent,
} from "@/lib/interactive-runs";
import type { SandboxRef } from "@/lib/mogplex-api/run-execution-launch";
import { resumeRunSandbox } from "./run-resume-sandbox";
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
  launchSandbox: resumeRunSandbox,
  runHarness: runHarnessViaRoute,
  loadAiCall: loadOwnedAiCall,
  appendEvent: safeAppendAiCallEvent,
  notifyRunReachedTerminalState: notifyTerminalSlackRunOnce,
  notifyRunCheckpoint: notifySlackRunCheckpoint,
};

/** Reconcile saved files and checkpoint evidence before applying the user's reply. */
export function buildResumeContinuePrompt(
  run: ExternalAgentRunRow,
  steer: string
): string {
  const trimmedSteer = steer.trim();
  return [
    `You are resuming a paused repo-agent run in its saved workspace on branch \`${run.working_branch}\`.`,
    "The workspace can contain uncommitted work. Preserve those files.",
    "First inspect `git status --short`, `git diff`, and `git log --oneline -5`. Verify the saved work before continuing. Do not assume it was committed or pushed. If prior work is missing, stop and report it.",
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

  // Keep the saved workspace attached across segments, including failed resumes.
  const repointed = await deps.updateRun(run.user_id, run.id, {
    ai_call_id: segmentAiCall.id,
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

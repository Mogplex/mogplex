import { refreshCompletedRunDelivery } from "@/lib/run-delivery/refresh";
/** Resume a checkpoint in its saved workspace, preserving uncommitted files. */
import {
  buildCheckpointProtocolInstructions,
  buildPlanFirstProtocolInstructions,
  PLAN_FIRST_PROTOCOL_HEADING,
} from "@/lib/harness/checkpoint";
import {
  createAiCall,
  loadOwnedAiCall,
  safeAppendAiCallEvent,
} from "@/lib/interactive-runs";
import type { SandboxRef } from "@/lib/mogplex-api/run-execution-launch";
import { deliveryResume } from "@/lib/run-delivery/resume";
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
  TERMINAL_RUN_STATUSES,
  type FinalizeDeps,
} from "@/lib/mogplex-api/run-execution-finalize";
import { notifySlackRunCheckpoint } from "@/lib/slack/run-checkpoint-notify";
import { notifyTerminalSlackRunOnce } from "./run-terminal-notification";
import type { ExternalAgentRunRow } from "@/lib/mogplex-api/runs";
import type {
  ResumeMode,
  ResumeExternalAgentRunPayload,
} from "./run-resume-queue";

export { queueResumeExternalAgentRun } from "./run-resume-queue";
export type {
  ResumeMode,
  ResumeExternalAgentRunPayload,
} from "./run-resume-queue";

export type ResumeExternalAgentRunDeps = FinalizeDeps & {
  delivery: typeof deliveryResume;
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
  delivery: deliveryResume,
  loadRun: loadRunForExecution,
  updateRun: updateExternalAgentRun,
  createAiCall,
  launchSandbox: resumeRunSandbox,
  runHarness: runHarnessViaRoute,
  loadAiCall: loadOwnedAiCall,
  appendEvent: safeAppendAiCallEvent,
  notifyRunReachedTerminalState: notifyTerminalSlackRunOnce,
  notifyRunCheckpoint: notifySlackRunCheckpoint,
  refreshDelivery: refreshCompletedRunDelivery,
};

const ORIGINAL_TASK_CHARS = 12_000;

function terminalResumeResult(run: ExternalAgentRunRow) {
  return {
    success: run.status === "success",
    runId: run.id,
    status: run.status,
    error: run.error,
  };
}

/** The run's task without its plan-first protocol, which no longer applies. */
function originalTask(prompt: string) {
  const task = prompt.split(PLAN_FIRST_PROTOCOL_HEADING)[0].trim();
  return task.length > ORIGINAL_TASK_CHARS
    ? `${task.slice(0, ORIGINAL_TASK_CHARS)}…`
    : task;
}

/** Reconcile saved files and checkpoint evidence before applying the user's reply. */
export function buildResumeContinuePrompt(
  run: ExternalAgentRunRow,
  steer: string,
  mode: ResumeMode = "review"
): string {
  const trimmedSteer = steer.trim();
  const reply = trimmedSteer || "(no additional instructions — proceed)";
  const summary =
    typeof run.metadata.checkpoint_summary === "string"
      ? run.metadata.checkpoint_summary.trim()
      : "";
  const header = [
    `You are resuming a paused repo-agent run in its saved workspace on branch \`${run.working_branch}\`.`,
    "The workspace can contain uncommitted work. Preserve those files.",
    "First inspect `git status --short`, `git diff`, and `git log --oneline -5`. Verify the saved work before continuing. Do not assume it was committed or pushed. If prior work is missing, stop and report it.",
    "",
    // A resumed segment starts a fresh agent session: restate the task and
    // what it paused on.
    "The original task:",
    originalTask(run.prompt),
    "",
    ...(summary
      ? ["What you reported at the checkpoint:", summary.slice(0, 4_000), ""]
      : []),
  ];
  if (mode === "delivery")
    return [
      ...header,
      "This is an automatic follow-up to an implementation the user already approved for PR delivery.",
      reply,
      "The PR is already open. Do not ask for the same implementation approval again or emit another checkpoint just to wait for CI. Report what you fixed and the exact checks you verified. Preserve the user's existing merge authority.",
    ].join("\n");
  if (mode === "plan")
    return [
      ...header,
      "The user reviewed your plan and asked for changes:",
      reply,
      "",
      "Revise the plan accordingly. Do not change files yet.",
      buildPlanFirstProtocolInstructions(),
    ].join("\n");
  if (mode === "plan_reply")
    return [
      ...header,
      "The user replied to your plan:",
      reply,
      "",
      "If the reply approves the plan (for example 'looks good', 'go ahead', 'approved'), implement it and follow the checkpoint protocol below. If it asks for changes or questions the plan, revise the plan instead, do not change files, and pause again under the plan-first protocol below.",
      "",
      buildCheckpointProtocolInstructions(),
      "",
      buildPlanFirstProtocolInstructions(),
    ].join("\n");
  return [
    ...header,
    "The user reviewed your last checkpoint and replied:",
    reply,
    "",
    buildCheckpointProtocolInstructions(),
  ].join("\n");
}

/**
 * Runs one resume segment for a paused run. Returns a not-found or conflict
 * result without side effects when the run cannot be resumed.
 */
export async function resumeExternalAgentRun(
  payload: ResumeExternalAgentRunPayload & { runtimeRunId: string },
  overrides: Partial<ResumeExternalAgentRunDeps> = {}
): Promise<ExternalAgentRunExecutionResult> {
  const deps: ResumeExternalAgentRunDeps = {
    ...defaultResumeDeps,
    ...overrides,
  };

  let run = await deps.loadRun(payload.runId, payload.userId);
  if (!run) {
    return {
      success: false,
      runId: payload.runId,
      status: "not_found",
      error: "External agent run not found",
    };
  }

  const delivery = payload.mode === "delivery";
  if (delivery) {
    if (
      !payload.delivery ||
      !(await deps.delivery.prepare(run, payload.delivery))
    )
      return { success: true, runId: run.id, status: run.status, error: null };
  } else if (
    run.status !== "awaiting_input" ||
    (payload.checkpointAiCallId &&
      payload.checkpointAiCallId !== run.ai_call_id)
  ) {
    // Only a run paused at a checkpoint can be resumed. A duplicate reply or a
    // race that already advanced the run lands here and is a no-op.
    return {
      success: false,
      runId: run.id,
      status: run.status,
      error: `Run is ${run.status}, not awaiting input`,
    };
  }

  if (!delivery && payload.followThrough) {
    const authorized = await deps.delivery.authorize(run);
    if (!authorized)
      return {
        success: false,
        runId: run.id,
        status: run.status,
        error:
          "This implementation checkpoint has changed. Refresh before approving.",
      };
    run = authorized;
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

  // Publish the new call and its worker together. Otherwise a status read can
  // reconcile this segment against the completed worker from the prior pass.
  // Keep the saved workspace attached across segments, including failed resumes.
  const repointed =
    delivery && payload.delivery
      ? await deps.delivery.claim({
          run,
          revision: payload.delivery.revision,
          headSha: payload.delivery.headSha,
          aiCallId: segmentAiCall.id,
          runtimeRunId: payload.runtimeRunId,
        })
      : payload.followThrough
        ? await deps.delivery.claimCheckpoint({
            run,
            aiCallId: segmentAiCall.id,
            runtimeRunId: payload.runtimeRunId,
          })
        : await deps.updateRun(run.user_id, run.id, {
            ai_call_id: segmentAiCall.id,
            runtime_provider: "trigger",
            runtime_run_id: payload.runtimeRunId,
            status: "streaming",
            error: null,
          });

  if (!repointed) {
    await deps.delivery.cancelCall(segmentAiCall.id);
    const current = await deps.loadRun(run.id, run.user_id);
    return {
      success: true,
      runId: run.id,
      status: current?.status ?? run.status,
      error: null,
    };
  }
  const segmentRun: ExternalAgentRunRow = {
    ...repointed,
    create_branch: false,
    prompt: buildResumeContinuePrompt(run, payload.steer, payload.mode),
  };

  try {
    const sandbox = await deps.launchSandbox(segmentRun);
    // Restoring a saved VM can take time. A cancellation during that wait wins.
    const current = await deps.loadRun(run.id, run.user_id);
    if (current && TERMINAL_RUN_STATUSES.has(current.status)) {
      return terminalResumeResult(current);
    }
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
    const current = await deps.loadRun(run.id, run.user_id);
    if (current && TERMINAL_RUN_STATUSES.has(current.status)) {
      return terminalResumeResult(current);
    }
    return await finalizeFailedPass(segmentRun, error, deps);
  }
}

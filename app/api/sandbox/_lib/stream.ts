import { buildSandboxName } from "@/lib/sandbox/sandbox-name";
import { sseEncode, createWorkingBranchInSandbox } from "./utils";
import { toStreamSandboxRecord } from "./response-shaping";
import {
  resolveSandboxLaunchEnvironment,
  provisionSandboxForLaunch,
  configureSandboxGitAccess,
} from "./provisioning";
import {
  transitionSandboxRecordToInstalling,
  createInitialSandboxLaunchState,
  emitStreamSandboxStatus,
  queueSandboxReadinessReconciliationWarning,
  consumeSandboxBootstrapStream,
} from "./bootstrap";
import {
  classifySandboxLaunchFailure,
  handleSandboxLaunchFailure,
  stopSandboxInstanceBestEffort,
  prepareSandboxLaunchBillingCloseBestEffort,
} from "./failure-handling";
import type { SandboxEvent } from "@/lib/sandbox/events";
import type { SandboxRecordRow } from "@/lib/types";
import type { SandboxLaunchPreparation } from "./types";
import type { SandboxPostDeps } from "./deps";

export async function executeSandboxLaunchStream(input: {
  deps: SandboxPostDeps;
  launch: SandboxLaunchPreparation;
  record: SandboxRecordRow;
  emit: (event: SandboxEvent) => void;
}) {
  const state = createInitialSandboxLaunchState(
    input.record,
    input.launch.repo
  );

  try {
    emitStreamSandboxStatus(input.emit, "creating", state.streamSandboxRecord);

    const environment = await resolveSandboxLaunchEnvironment({
      launch: input.launch,
      emit: input.emit,
    });
    const provisioned = await provisionSandboxForLaunch({
      deps: input.deps,
      launch: input.launch,
      environment,
      emit: input.emit,
      sandboxRecordId: input.record.id,
      sandboxName:
        input.launch.sandboxNameOverride ??
        buildSandboxName({
          repoId: input.launch.repoId,
          workingBranch: input.launch.launchRequest.workingBranch,
          recordId: input.record.id,
          userId: input.launch.creds.userId,
          productTeamId: input.launch.productTeamId,
          rootDirectory: input.launch.effectiveRootDirectory,
        }),
    });

    state.sandbox = provisioned.sandbox;
    state.restoredFromSnapshot = provisioned.restoredFromSnapshot;
    state.restoredFromBaselineSnapshot =
      provisioned.restoredFromBaselineSnapshot;
    state.shouldQueueDeferredSnapshot = provisioned.shouldQueueDeferredSnapshot;

    const installing = await transitionSandboxRecordToInstalling({
      recordId: input.record.id,
      sandboxId: state.sandbox.name,
      sandbox: state.sandbox,
    });
    if (!installing) {
      await prepareSandboxLaunchBillingCloseBestEffort({
        deps: input.deps,
        recordId: input.record.id,
        phase: "install transition conflict",
      });
      await stopSandboxInstanceBestEffort(state.sandbox);
      input.emit({
        type: "error",
        message: "Sandbox creation was superseded by a newer state change.",
        phase: "create",
      });
      return;
    }

    state.streamSandboxRecord = installing;
    await input.deps.requireSandboxBillingSession(
      input.record.id,
      state.sandbox
    );

    // No file or command operation may run before the provider session is
    // either metered, explicitly comped, BYO-billed, or billing-disabled.
    await configureSandboxGitAccess({
      sandbox: state.sandbox,
      githubToken: input.launch.githubToken,
      userId: input.launch.creds.userId,
    });
    // Baseline-restore bootstrap handles branch creation/switching itself via
    // `git checkout -b` + `git push -u origin`, so skip the clone-branch
    // helper for that path to avoid a redundant "branch already exists" race.
    if (
      input.launch.launchRequest.createBranch &&
      !state.restoredFromBaselineSnapshot
    ) {
      await createWorkingBranchInSandbox(state.sandbox, {
        ...input.launch.launchRequest,
        // Use the launch-time effective path so the branch is created in
        // the same workspace the dev server will boot at, not the repo's
        // persistent default.
        rootDirectory: input.launch.effectiveRootDirectory,
      });
    }

    input.emit({
      type: "sandbox_created",
      sandboxId: state.sandbox.name,
      recordId: input.record.id,
      sandbox: toStreamSandboxRecord(state.streamSandboxRecord),
    });

    await queueSandboxReadinessReconciliationWarning({
      deps: input.deps,
      recordId: input.record.id,
      sandboxId: state.sandbox.name,
      emit: input.emit,
    });
    await consumeSandboxBootstrapStream({
      state,
      launch: input.launch,
      deps: input.deps,
      environment,
      emit: input.emit,
    });
  } catch (err) {
    const failure = classifySandboxLaunchFailure(err);
    console.error(`[sandbox/create] ERR_MSG=${failure.message}`);
    console.error(
      `[sandbox/create] repoId=${input.launch.repoId} projectId=${input.launch.createContext.credentials.vercelProjectId} teamId=${input.launch.createContext.credentials.vercelTeamId}`
    );
    await handleSandboxLaunchFailure({
      err,
      state,
      launch: input.launch,
      deps: input.deps,
      emit: input.emit,
    });
  }
}

export function buildSandboxLaunchStreamResponse(input: {
  deps: SandboxPostDeps;
  launch: SandboxLaunchPreparation;
  record: SandboxRecordRow;
}) {
  const encoder = new TextEncoder();
  let cancelled = false;
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: SandboxEvent) => {
        if (cancelled) return;
        try {
          controller.enqueue(encoder.encode(sseEncode(event)));
        } catch {
          cancelled = true;
        }
      };

      try {
        await executeSandboxLaunchStream({
          deps: input.deps,
          launch: input.launch,
          record: input.record,
          emit,
        });
      } finally {
        controller.close();
      }
    },
    cancel() {
      cancelled = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

import { buildAiCallCompletionUpdate } from "@/lib/interactive-runs";
import type { HarnessId } from "@/lib/harness/config";
import type { SandboxHarnessPostDeps } from "./types";

export type AiCallSetupInput = {
  userId: string;
  harnessId: HarnessId;
  sandboxRecordId: string;
  sandboxId: string;
  conversationId: string | null;
  repoId: string | null;
  repoFullName: string | null;
  productTeamId: string | null;
  aiBillingSource: string;
  normalizedMode: string | null;
  prepareOnly: boolean;
  existingAiCallId: string | null;
};

export type AiCallRecord = {
  id: string;
  started_at: string | null;
  metadata: Record<string, unknown> | null;
};

/**
 * Creates or claims an AI call record for the harness run.
 */
export async function setupAiCall(
  deps: Pick<
    SandboxHarnessPostDeps,
    "loadOwnedAiCall" | "createAiCall" | "mergeAiCallMetadata"
  >,
  input: AiCallSetupInput
): Promise<
  | { ok: true; aiCall: AiCallRecord; existingAiCall: AiCallRecord | null }
  | { ok: false; error: string; status: number }
> {
  const existingAiCall = input.existingAiCallId
    ? await deps.loadOwnedAiCall(input.userId, input.existingAiCallId)
    : null;

  if (input.existingAiCallId && !existingAiCall) {
    return { ok: false, error: "ai_call not found", status: 404 };
  }

  const isPreparedCliCall =
    existingAiCall?.metadata?.source === "cli" &&
    existingAiCall.metadata?.prepared === true &&
    existingAiCall.metadata?.sandbox_record_id === input.sandboxRecordId &&
    existingAiCall.metadata?.harness_id === input.harnessId;

  if (
    existingAiCall &&
    existingAiCall.metadata?.source !== "external-api" &&
    !isPreparedCliCall
  ) {
    return {
      ok: false,
      error: "ai_call is not available for this harness run",
      status: 409,
    };
  }

  if (existingAiCall && existingAiCall.status !== "pending") {
    return { ok: false, error: "ai_call is not pending", status: 409 };
  }

  const harnessMetadataPatch = {
    source: "cli",
    harness_id: input.harnessId,
    harness_mode: input.normalizedMode,
    sandbox_record_id: input.sandboxRecordId,
    sandbox_id: input.sandboxId,
    repo: input.repoFullName,
    product_team_id: input.productTeamId,
    ai_billing_source: input.aiBillingSource,
  };

  const createdAiCallMetadata = {
    ...existingAiCall?.metadata,
    ...harnessMetadataPatch,
    prepared: input.prepareOnly,
  };

  const aiCall = existingAiCall
    ? await deps.mergeAiCallMetadata({
        userId: input.userId,
        aiCallId: existingAiCall.id,
        metadata: { ...harnessMetadataPatch, prepared: false },
      })
    : await deps.createAiCall({
        userId: input.userId,
        type: "agent",
        model: `harness:${input.harnessId}`,
        conversationId: input.conversationId,
        repoId: input.repoId,
        status: "pending",
        metadata: createdAiCallMetadata,
      });

  if (!aiCall) {
    console.error("[harness] failed to merge existing ai_call metadata", {
      aiCallId: existingAiCall?.id ?? null,
      sandboxRecordId: input.sandboxRecordId,
      userId: input.userId,
    });
    return { ok: false, error: "Harness initialization failed", status: 500 };
  }

  return { ok: true, aiCall, existingAiCall };
}

export type FinalizeCancelledRunInput = {
  aiCallId: string;
  aiCallStartedAt: string | null;
  aiCallMetadata: Record<string, unknown> | null;
  userId: string;
  conversationId: string | null;
  repoId: string | null;
  runtimeCommandId?: string | null;
  installLogs?: string;
};

/**
 * Creates a function to finalize a cancelled harness run, marking the
 * AI call as cancelled and emitting the appropriate event.
 */
export function createFinalizeCancelledRun(
  deps: Pick<
    SandboxHarnessPostDeps,
    | "loadOwnedAiCall"
    | "finalizeAiCallAsCancelledIfActive"
    | "safeAppendAiCallEvent"
  >,
  base: Omit<FinalizeCancelledRunInput, "runtimeCommandId" | "installLogs">
): (input?: {
  runtimeCommandId?: string | null;
  installLogs?: string;
}) => Promise<boolean> {
  return async (input) => {
    const currentCall = await deps.loadOwnedAiCall(base.userId, base.aiCallId);
    const cancelRequestedAt =
      currentCall?.cancel_requested_at ?? new Date().toISOString();

    const cancelledCall = await deps.finalizeAiCallAsCancelledIfActive(
      base.aiCallId,
      buildAiCallCompletionUpdate({
        startedAt: base.aiCallStartedAt ?? new Date().toISOString(),
        status: "cancelled",
        cancelRequestedAt,
        controlState: "cancelled",
        runtimeCommandId:
          input?.runtimeCommandId ?? currentCall?.runtime_command_id ?? null,
        metadata: currentCall?.metadata ?? base.aiCallMetadata ?? {},
      })
    );

    if (!cancelledCall) return false;

    await deps.safeAppendAiCallEvent({
      aiCallId: base.aiCallId,
      userId: base.userId,
      conversationId: base.conversationId,
      repoId: base.repoId,
      eventType: "cancelled",
      message: "Harness run cancelled",
      payload: {
        runtime_command_id: input?.runtimeCommandId ?? null,
        install_logs_present: Boolean(input?.installLogs),
      },
    });

    return true;
  };
}

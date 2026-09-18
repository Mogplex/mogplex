import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { buildAiCallCompletionUpdate } from "@/lib/interactive-runs";
import { extractVercelApiErrorDetail } from "@/lib/sandbox/api-error";
import { presentSandboxBillingAdmissionError } from "@/lib/billing/sandbox-usage";
import type { HarnessId } from "@/lib/harness/config";
import type { AiCallRecord } from "./ai-call";
import type { SandboxHarnessPostDeps } from "./types";

/**
 * Finalizes the ai_call and builds the error response after harness setup or
 * execution throws. A sandbox that has gone away is reported as 410 and its
 * record marked stopped; every other failure keeps the billing status when
 * the error is a billing admission problem.
 */
export async function buildHarnessFailureResponse(
  deps: Pick<
    SandboxHarnessPostDeps,
    "finalizeAiCallIfNotCancelled" | "safeAppendAiCallEvent"
  >,
  err: unknown,
  ctx: {
    aiCall: AiCallRecord;
    userId: string;
    sandboxRecordId: string;
    sandboxId: string;
    repoId: string | null;
    conversationId: string | null;
    harnessId: HarnessId;
  }
) {
  const { aiCall } = ctx;
  const billingError = presentSandboxBillingAdmissionError(err);
  const rawMessage =
    billingError?.message ??
    (err instanceof Error ? err.message : "Harness execution failed");
  const apiDetail = extractVercelApiErrorDetail(err);
  const message = apiDetail ? `${rawMessage} — ${apiDetail}` : rawMessage;

  console.error("[harness] execution failed", {
    aiCallId: aiCall.id,
    sandboxRecordId: ctx.sandboxRecordId,
    sandboxId: ctx.sandboxId,
    harnessId: ctx.harnessId,
    message: rawMessage,
    apiDetail,
  });

  if (
    /status code 410/i.test(rawMessage) ||
    /sandbox.*(stopped|gone)/i.test(rawMessage)
  ) {
    supabaseAdmin
      .from("sandboxes")
      .update({ status: "stopped" })
      .eq("id", ctx.sandboxRecordId)
      .then(({ error }) => {
        if (error)
          console.warn("Failed to mark sandbox stopped:", error.message);
      });

    await deps.finalizeAiCallIfNotCancelled(
      aiCall.id,
      buildAiCallCompletionUpdate({
        startedAt: aiCall.started_at ?? new Date().toISOString(),
        status: "failed",
        error: "Sandbox has stopped",
        metadata: aiCall.metadata ?? undefined,
      })
    );
    return NextResponse.json(
      { error: "Sandbox has stopped. Launch a new sandbox to continue." },
      { status: 410 }
    );
  }
  const finalizedCall = await deps.finalizeAiCallIfNotCancelled(
    aiCall.id,
    buildAiCallCompletionUpdate({
      startedAt: aiCall.started_at ?? new Date().toISOString(),
      status: "failed",
      error: message,
      metadata: aiCall.metadata ?? undefined,
    })
  );
  if (finalizedCall) {
    await deps.safeAppendAiCallEvent({
      aiCallId: aiCall.id,
      userId: ctx.userId,
      conversationId: ctx.conversationId,
      repoId: ctx.repoId,
      eventType: "failed",
      message: "Harness execution failed",
      payload: { error: message },
    });
  }
  return NextResponse.json(
    { error: message },
    { status: billingError?.status ?? 500 }
  );
}

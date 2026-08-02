import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import {
  appendAiCallEvent,
  buildAiCallCompletionUpdate,
  finalizeAiCallAsCancelledIfActive,
  loadOwnedAiCall,
  requestAiCallCancellationIfActive,
} from "@/lib/interactive-runs";
import {
  buildSandboxRouteErrorResponse,
  loadOwnedSandboxRouteContext,
} from "@/lib/sandbox/route-context";

type SandboxCancelRecord = {
  sandbox_id: string;
  billing_source?: string | null;
  billing_team_id?: string | null;
  billing_project_id?: string | null;
  vercel_team_id?: string | null;
  vercel_project_id?: string | null;
};

type ObservabilityCallCancelPostDeps = {
  requireUserId: typeof requireUserId;
  loadOwnedAiCall: typeof loadOwnedAiCall;
  requestAiCallCancellationIfActive: typeof requestAiCallCancellationIfActive;
  finalizeAiCallAsCancelledIfActive: typeof finalizeAiCallAsCancelledIfActive;
  appendAiCallEvent: typeof appendAiCallEvent;
  loadOwnedSandboxRouteContext: typeof loadOwnedSandboxRouteContext<SandboxCancelRecord>;
};

const SANDBOX_CANCEL_ROUTE_SELECT =
  "sandbox_id, billing_source, billing_team_id, billing_project_id, vercel_team_id, vercel_project_id";

const defaultObservabilityCallCancelPostDeps: ObservabilityCallCancelPostDeps =
  {
    requireUserId,
    loadOwnedAiCall,
    requestAiCallCancellationIfActive,
    finalizeAiCallAsCancelledIfActive,
    appendAiCallEvent,
    loadOwnedSandboxRouteContext,
  };

export function createObservabilityCallCancelPostHandler(
  overrides: Partial<ObservabilityCallCancelPostDeps> = {}
) {
  const deps: ObservabilityCallCancelPostDeps = {
    ...defaultObservabilityCallCancelPostDeps,
    ...overrides,
  };

  return async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
  ) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    const { id } = await params;
    const aiCall = await deps.loadOwnedAiCall(userId, id);

    if (!aiCall) {
      return NextResponse.json({ error: "Call not found" }, { status: 404 });
    }

    if (!["pending", "streaming"].includes(aiCall.status)) {
      return NextResponse.json(
        { error: "Call is no longer active" },
        { status: 409 }
      );
    }

    const cancelRequestedAt =
      aiCall.cancel_requested_at ?? new Date().toISOString();
    const currentCall =
      aiCall.control_state === "cancel_requested" ||
      aiCall.control_state === "cancelled"
        ? aiCall
        : await deps.requestAiCallCancellationIfActive(
            aiCall.id,
            cancelRequestedAt
          );

    if (!currentCall) {
      return NextResponse.json(
        { error: "Call is no longer active" },
        { status: 409 }
      );
    }

    if (
      aiCall.control_state !== "cancel_requested" &&
      aiCall.control_state !== "cancelled"
    ) {
      await deps.appendAiCallEvent({
        aiCallId: aiCall.id,
        userId,
        conversationId: aiCall.conversation_id,
        repoId: aiCall.repo_id,
        eventType: "cancel_requested",
        message: "Cancellation requested",
        payload: {
          runtime_command_id: currentCall.runtime_command_id,
        },
      });
    }

    if (!currentCall.runtime_command_id) {
      const cancelledCall = await deps.finalizeAiCallAsCancelledIfActive(
        aiCall.id,
        buildAiCallCompletionUpdate({
          startedAt: aiCall.started_at,
          status: "cancelled",
          cancelRequestedAt,
          controlState: "cancelled",
          metadata: currentCall.metadata,
        })
      );

      if (!cancelledCall) {
        const latestCall = await deps.loadOwnedAiCall(userId, aiCall.id);
        return NextResponse.json({
          ok: true,
          status: latestCall?.status ?? "unknown",
        });
      }

      await deps.appendAiCallEvent({
        aiCallId: aiCall.id,
        userId,
        conversationId: aiCall.conversation_id,
        repoId: aiCall.repo_id,
        eventType: "cancelled",
        message: "Run cancelled without runtime command",
        payload: {
          reason: "NO_RUNTIME_COMMAND",
        },
      });

      return NextResponse.json({ ok: true, status: "cancelled" });
    }

    const sandboxRecordId =
      typeof currentCall.metadata?.sandbox_record_id === "string"
        ? currentCall.metadata.sandbox_record_id
        : null;

    if (!sandboxRecordId) {
      return NextResponse.json(
        { error: "Missing sandbox metadata" },
        { status: 400 }
      );
    }

    const sandboxData = await deps.loadOwnedSandboxRouteContext(
      request,
      sandboxRecordId,
      {
        select: SANDBOX_CANCEL_ROUTE_SELECT,
      }
    );
    if (!sandboxData.ok) {
      return buildSandboxRouteErrorResponse(sandboxData);
    }
    if (!sandboxData.sandbox) {
      return NextResponse.json(
        { error: "Sandbox is not ready" },
        { status: 409 }
      );
    }

    try {
      const command = await sandboxData.sandbox.getCommand(
        currentCall.runtime_command_id
      );
      await command.kill();

      const cancelledCall = await deps.finalizeAiCallAsCancelledIfActive(
        aiCall.id,
        buildAiCallCompletionUpdate({
          startedAt: aiCall.started_at,
          status: "cancelled",
          cancelRequestedAt,
          controlState: "cancelled",
          runtimeCommandId: currentCall.runtime_command_id,
          metadata: currentCall.metadata,
        })
      );

      if (!cancelledCall) {
        const latestCall = await deps.loadOwnedAiCall(userId, aiCall.id);
        return NextResponse.json({
          ok: true,
          status: latestCall?.status ?? "unknown",
        });
      }

      await deps.appendAiCallEvent({
        aiCallId: aiCall.id,
        userId,
        conversationId: aiCall.conversation_id,
        repoId: aiCall.repo_id,
        eventType: "cancelled",
        message: "Run cancelled",
        payload: {
          runtime_command_id: currentCall.runtime_command_id,
        },
      });

      return NextResponse.json({ ok: true, status: "cancelled" });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to cancel call";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  };
}

export const POST = createObservabilityCallCancelPostHandler();

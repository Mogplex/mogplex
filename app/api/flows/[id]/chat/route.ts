import { requireUserId } from "@/lib/auth";
import { streamFlowAssistantChat } from "@/lib/flows/api";
import {
  getFlowServiceErrorStatus,
  isFlowServiceError,
} from "@/lib/flows/errors";
import {
  buildLimitResponse,
  enforceChatLimits,
  recordLimitDecision,
  releaseLimitClaim,
} from "@/lib/request-limits";
import {
  ALLOWLIST_UNAVAILABLE_RETRY_AFTER_SECONDS,
  isModelAllowlistUnavailableError,
  MODEL_ALLOWLIST_UNAVAILABLE_ERROR,
  readActiveTeamIdHeader,
  resolveActiveTeamCapabilities,
} from "@/lib/team-capabilities";

export const runtime = "nodejs";
export const maxDuration = 60;

type ChatLimitDecision = Awaited<ReturnType<typeof enforceChatLimits>>;
type RecordLimitDecisionInput = Parameters<typeof recordLimitDecision>[0];
type StreamReleaseContext = "close" | "incomplete";

const CHAT_ROUTE_KEY: Parameters<typeof releaseLimitClaim>[0]["routeKey"] &
  RecordLimitDecisionInput["routeKey"] = "chat";

/**
 * Wrap a streaming Response so `release()` runs when the body stream finishes,
 * errors, or is cancelled by the client — not at dispatch time. This is what
 * gives the concurrent_chat_runs claim a meaningful hold window: without it,
 * the claim would be released as soon as streamText() returns the Response
 * object and N parallel requests could all pass the concurrency gate.
 *
 * If the response has no body (shouldn't happen for a UI message stream), we
 * release immediately and pass through.
 *
 * Use the platform pipe machinery instead of a manual reader/readable pair so
 * the upstream body still observes downstream back-pressure. `release` may be
 * reached from more than one stream lifecycle path, so the wrapper makes the
 * callback idempotent before invoking it. This relies on this route's nodejs
 * runtime: if the route is moved to an edge runtime, re-verify that client
 * cancel still rejects the pipeTo() promise and reaches the release callback.
 */
function wrapResponseToReleaseOnClose(
  response: Response,
  release: (context: StreamReleaseContext) => Promise<void>
): Response {
  let releaseStarted = false;
  const safeRelease = async (
    context: StreamReleaseContext,
    cause?: unknown
  ) => {
    // Safe for this route's nodejs runtime: stream lifecycle continuations run
    // on the single-threaded JS microtask queue. Re-check if this moves to edge.
    if (releaseStarted) return;
    releaseStarted = true;
    try {
      await release(context);
    } catch (releaseErr) {
      // Don't let a release failure mask the real stream error or get
      // silently swallowed once the controller has already been errored.
      const details =
        cause === undefined ? releaseErr : { releaseErr, streamCause: cause };
      console.error(
        `[flow-assistant-chat] release failed during ${context}`,
        details
      );
    }
  };

  if (!response.body) {
    void safeRelease("close");
    return response;
  }

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  // The transformed response stream receives source errors/downstream
  // cancellations through pipeTo(). Swallow the pipe promise rejection here so
  // release failures are logged by safeRelease without creating an unhandled
  // rejection. Both source errors and client cancels are incomplete turns, so
  // they release the concurrent claim without recording an accepted start.
  void response.body
    .pipeTo(writable)
    .then(() => safeRelease("close"))
    .catch((error) => safeRelease("incomplete", error));

  return new Response(readable, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

type FlowAssistantChatRouteDeps = {
  requireUserId: typeof requireUserId;
  streamFlowAssistantChat: typeof streamFlowAssistantChat;
  enforceChatLimits: typeof enforceChatLimits;
  recordLimitDecision: typeof recordLimitDecision;
  releaseLimitClaim: typeof releaseLimitClaim;
  resolveActiveTeamCapabilities: typeof resolveActiveTeamCapabilities;
};

export function createFlowAssistantChatPostHandler(
  overrides: Partial<FlowAssistantChatRouteDeps> = {}
) {
  const deps: FlowAssistantChatRouteDeps = {
    requireUserId,
    streamFlowAssistantChat,
    enforceChatLimits,
    recordLimitDecision,
    releaseLimitClaim,
    resolveActiveTeamCapabilities,
    ...overrides,
  };

  return async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
  ) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    const { id } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const record = (body ?? {}) as Record<string, unknown>;
    const messages = Array.isArray(record.messages) ? record.messages : null;
    if (!messages) {
      return Response.json({ error: "messages is required" }, { status: 400 });
    }

    const activeTeam = await deps.resolveActiveTeamCapabilities(
      userId,
      readActiveTeamIdHeader(request)
    );
    if (!activeTeam.ok) {
      return Response.json(
        { error: activeTeam.error },
        { status: activeTeam.status }
      );
    }

    // Throttle flow-assistant turns against the same per-user chat admission
    // pool as the main chat route (concurrent_chat_runs + hourly/daily starts).
    // Unlike the main chat route we do NOT link the claim to an ai_calls row,
    // so we have to release the claim ourselves. We release on stream
    // completion/cancel/error (not at dispatch) so the concurrent_chat_runs
    // slot is actually held for the duration of the stream — otherwise the
    // concurrency gate collapses to near-zero ms and provides no back-pressure.
    // The unmatched claim would also otherwise be counted as a provisional
    // concurrent chat for ~5 min by claim_chat_limit_admission's NOT EXISTS
    // ai_calls branch. On stream close we replace the provisional claim row
    // with a claim-less allowed event so hourly/daily start windows still
    // meter accepted flow-assistant turns without keeping a concurrent slot.
    let limit: ChatLimitDecision;
    try {
      limit = await deps.enforceChatLimits({ userId });
    } catch (error) {
      console.error(
        "[flow-assistant-chat] failed to enforce chat limits",
        error
      );
      return Response.json(
        {
          error: "Unable to check chat limits",
          code: "chat_limit_check_failed",
          retryAfterSeconds: 15,
        },
        {
          status: 503,
          headers: { "Retry-After": "15" },
        }
      );
    }
    if (!limit.allowed) return buildLimitResponse(limit);
    const limitClaimId = limit.claimId;
    if (!limitClaimId) {
      // enforceChatLimits gets allowed claims through mapAtomicLimitClaimResult,
      // which throws if the RPC omits claim_id. Keep this fail-loud guard for
      // test stubs and future claim-less paths while the public type remains
      // optional.
      // Keep this before wrapResponseToReleaseOnClose(): there is no claim to
      // release here and no stream has started, so returning without a cleanup
      // wrapper or durable metering event is intentional.
      console.error(
        "[flow-assistant-chat] allowed chat limit decision missing claimId"
      );
      return Response.json(
        {
          error: "Unable to start flow assistant chat",
          code: "chat_limit_claim_missing",
        },
        { status: 500 }
      );
    }
    const releaseClaim = async () =>
      deps.releaseLimitClaim({
        userId,
        routeKey: CHAT_ROUTE_KEY,
        claimId: limitClaimId,
      });
    const releaseClaimAndRecordAcceptedStart = async (
      context: StreamReleaseContext
    ) => {
      const released = await releaseClaim();
      if (context !== "close") {
        return;
      }
      if (!released) {
        // releaseLimitClaim returns false for a DB failure, not for an
        // idempotent zero-row delete; Supabase deletes without matching rows do
        // not error. Avoid metering if the concurrent claim may still be live.
        return;
      }
      await deps.recordLimitDecision({
        userId,
        routeKey: CHAT_ROUTE_KEY,
        // claimId deliberately omitted: the claim was already released above,
        // so this meters hourly/daily windows without holding a concurrent slot.
        decision: { allowed: true },
        resourceId: id,
      });
    };

    try {
      // Flow ownership is enforced inside streamFlowAssistantChat via
      // loadOwnedFlowProd (throws FLOW_NOT_FOUND if the flow is not owned by
      // userId). Keep that invariant if this handler is ever refactored.
      const response = await deps.streamFlowAssistantChat({
        userId,
        flowId: id,
        teamId: activeTeam.teamId,
        capabilities: activeTeam.capabilities,
        messages: messages as Parameters<
          typeof streamFlowAssistantChat
        >[0]["messages"],
      });
      return wrapResponseToReleaseOnClose(
        response,
        releaseClaimAndRecordAcceptedStart
      );
    } catch (error) {
      // Stream never started — refund so a failed start doesn't count against
      // quota and doesn't leak a provisional concurrent slot.
      // Guard the release so an unexpected throw here can't replace the
      // original error (we'd lose the model/flow failure context and the
      // client would get a generic 500 with no signal of what actually broke).
      // `releaseLimitClaim` already has internal try/catch for DB errors;
      // this is a belt-and-suspenders second layer for anything unexpected.
      try {
        await releaseClaim();
      } catch (releaseErr) {
        console.error(
          "[flow-assistant-chat] release failed on error path",
          releaseErr
        );
      }
      if (isFlowServiceError(error)) {
        return Response.json(
          {
            error: error.message,
            code: error.code,
            ...(error.details ? { details: error.details } : {}),
          },
          { status: getFlowServiceErrorStatus(error) }
        );
      }
      console.error("[flow-assistant-chat]", error);
      // See the assistant route: team-scoped, so the allowlist gate is
      // reachable, and this failure is transient rather than a bug.
      if (isModelAllowlistUnavailableError(error)) {
        return Response.json(
          { error: MODEL_ALLOWLIST_UNAVAILABLE_ERROR },
          {
            status: 503,
            headers: {
              "Retry-After": String(ALLOWLIST_UNAVAILABLE_RETRY_AFTER_SECONDS),
            },
          }
        );
      }
      return Response.json(
        { error: "Failed to start flow assistant chat" },
        { status: 500 }
      );
    }
  };
}

export const POST = createFlowAssistantChatPostHandler();

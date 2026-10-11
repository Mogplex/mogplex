import { consumeStream } from "ai";
import { buildInternalApiHeaders } from "@/lib/internal-api-auth";
import { executeControlChatRequest } from "@/app/api/control/chat/_lib/execute";
import { resolveControlChatSessionContext } from "@/app/api/control/chat/_lib/context";
import {
  readLatestControlUserText,
  validateControlChatMessages,
} from "@/app/api/control/chat/_lib/messages";
import { resolveInfrastructureDiagnosticScope } from "@/lib/agents/user-facing-output";
import { createControlNativeExecution } from "./native-execution";
import { createTableEventListener } from "@/lib/db/table-event-listener";
import { createControlSupabaseListener } from "./continuation-supabase-listener";
import {
  assertControlTurnCurrent,
  claimControlTurn,
  loadControlTurnCall,
} from "./turn-store";
import { controlTurnPayload, type ControlTurnPayload } from "./turn-supervisor";

export async function executeControlTurn(
  raw: ControlTurnPayload,
  runtimeRunId: string,
  signal: AbortSignal
) {
  const payload = controlTurnPayload.parse(raw);
  const turn = await claimControlTurn(
    payload.userId,
    payload.aiCallId,
    runtimeRunId
  );
  if (!turn) return { status: "not_claimed" };
  const controller = new AbortController();
  const combinedSignal = AbortSignal.any([signal, controller.signal]);
  const assertCurrent = async () => {
    combinedSignal.throwIfAborted();
    await assertControlTurnCurrent(turn, runtimeRunId);
  };
  const listener =
    process.env.MOGPLEX_DATA_BACKEND === "neon"
      ? await createTableEventListener()
      : await createControlSupabaseListener({
          userId: payload.userId,
          sessionId: turn.session_id,
          continuationId: payload.aiCallId,
          callId: payload.aiCallId,
        });
  listener.onError((error) => controller.abort(error));
  listener.onNotification((event) => {
    if (
      event.user_id === payload.userId &&
      ((event.table === "ai_calls" && event.id === payload.aiCallId) ||
        (event.table === "control_sessions" && event.id === turn.session_id))
    ) {
      void loadControlTurnCall(payload.userId, payload.aiCallId)
        .then(async (call) => {
          // Successful finalization ends the run; its completion hooks still drain.
          if (call?.status !== "success") await assertCurrent();
        })
        .catch((error) => controller.abort(error));
    }
  });
  try {
    await assertCurrent();
    const call = await loadControlTurnCall(payload.userId, payload.aiCallId);
    if (!call) throw new Error("The Control run is no longer available.");
    const body = await resolveControlChatSessionContext(
      payload.userId,
      turn.request_context
    );
    const messages = await validateControlChatMessages(body.messages);
    const latestUserText = readLatestControlUserText(messages);
    const req = new Request("https://internal.mogplex/api/control/chat", {
      method: "POST",
      signal: combinedSignal,
      headers: buildInternalApiHeaders(payload.userId, {
        teamId: turn.team_id,
      }),
    });
    const result = await executeControlChatRequest({
      req,
      userId: payload.userId,
      body,
      resolvedModel: call.model,
      limitClaimId: turn.limit_claim_id,
      callStartedAt: new Date(call.started_at).toISOString(),
      infrastructureDiagnosticScope:
        resolveInfrastructureDiagnosticScope(latestUserText),
      latestUserText,
      preparedCall: call,
      background: {
        assertCurrent,
        onAiCallStarted: async () => undefined,
        onTranscriptComplete: async () => undefined,
        systemContext: "",
        expectedContext: body,
        sandboxExecution: createControlNativeExecution(
          call,
          turn.team_id,
          combinedSignal
        ),
      },
    });
    if (result.response.body)
      await consumeStream({
        stream: result.response.body,
        onError: (error) => {
          throw error;
        },
      });
    await result.completion;
    return {
      status:
        (await loadControlTurnCall(payload.userId, payload.aiCallId))?.status ??
        "unknown",
    };
  } finally {
    await listener.end();
  }
}

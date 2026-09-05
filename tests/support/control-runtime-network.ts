import { randomUUID } from "node:crypto";
import { setImmediate as nextEventLoopTurn } from "node:timers/promises";
import type { UIMessage } from "ai";
import type { ControlContinuation } from "../../lib/control/continuation-store";
import type {
  TableEventListener,
  TableEventPayload,
} from "../../lib/db/table-event-listener";

/** HTTP/database-notification boundary fixture. All Control/SDK code runs normally. */
export function controlRuntimeNetwork() {
  const userId = randomUUID();
  const sessionId = randomUUID();
  const repoId = randomUUID();
  const original: UIMessage = {
    id: "original-request",
    role: "user",
    parts: [
      {
        type: "text",
        text: "Review the finished workers and report the result.",
      },
    ],
  };
  const session = {
    id: sessionId,
    user_id: userId,
    repo_id: repoId,
    orchestration_run_id: randomUUID(),
    model_id: "openai/gpt-4o",
    title: "Worker review",
    archived: false,
    messages: [original] as UIMessage[],
  };
  const ticket: ControlContinuation = {
    id: randomUUID(),
    user_id: userId,
    session_id: sessionId,
    parent_ai_call_id: randomUUID(),
    origin_message: { ...original },
    worker_run_ids: [randomUUID()],
    request_context: {
      repoId,
      missionId: sessionId,
      model: session.model_id,
      mode: "run",
      enableTools: false,
    },
    instruction: "Read the worker result and report it.",
    parent_ready: true,
    status: "ready",
    runtime_run_id: null,
    resume_ai_call_id: null,
    error: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const calls: Record<string, unknown>[] = [];
  const savedEvents: Record<string, unknown>[] = [];
  const providerRequests: Record<string, unknown>[] = [];
  let notification: ((event: TableEventPayload) => void) | undefined;
  let closed = false;
  let providerStatus = 200;
  let beforeProvider: (() => Promise<void>) | undefined;
  let failTranscript = false;
  const createListener = async (): Promise<TableEventListener> => ({
    onNotification: (handler) => {
      notification = handler;
    },
    onError: () => undefined,
    end: async () => {
      closed = true;
    },
  });
  const fetchBoundary: typeof fetch = async (input, init) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    const body = req.body
      ? ((await req.json()) as Record<string, unknown>)
      : {};
    if (url.hostname === "api.openai.com") {
      providerRequests.push(body);
      await beforeProvider?.();
      req.signal.throwIfAborted();
      if (providerStatus !== 200)
        return Response.json(
          {
            error: {
              message: "Fixture provider refused credentials",
              type: "invalid_request_error",
            },
          },
          { status: providerStatus }
        );
      const chunks = [
        {
          type: "response.created",
          response: { id: "resp_fixture", created_at: 1, model: "gpt-4o" },
        },
        {
          type: "response.output_item.added",
          output_index: 0,
          item: {
            type: "message",
            id: "msg_fixture",
            role: "assistant",
            content: [],
          },
        },
        {
          type: "response.output_text.delta",
          item_id: "msg_fixture",
          output_index: 0,
          content_index: 0,
          delta:
            "The worker results are saved. No additional changes were made.",
        },
        {
          type: "response.output_item.done",
          output_index: 0,
          item: {
            type: "message",
            id: "msg_fixture",
            role: "assistant",
            content: [
              {
                type: "output_text",
                text: "The worker results are saved. No additional changes were made.",
                annotations: [],
              },
            ],
          },
        },
        {
          type: "response.completed",
          response: {
            id: "resp_fixture",
            status: "completed",
            usage: { input_tokens: 100, output_tokens: 15 },
            incomplete_details: null,
          },
        },
      ];
      return new Response(
        chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join(""),
        { headers: { "content-type": "text/event-stream" } }
      );
    }
    if (url.hostname !== "control-db.example.test")
      throw new Error(
        `Unexpected external request: ${url.origin}${url.pathname}`
      );
    const name = url.pathname.split("/").at(-1)!;
    if (url.pathname.includes("/rpc/")) {
      if (name === "control_claim_continuation") {
        if (
          body.p_user_id !== userId ||
          body.p_continuation_id !== ticket.id ||
          ticket.status !== "ready"
        )
          return Response.json(null);
        ticket.status = "running";
        ticket.runtime_run_id = String(body.p_runtime_run_id);
        return Response.json(ticket);
      }
      if (name === "control_save_messages") {
        if (failTranscript)
          return Response.json(
            { message: "Fixture checkpoint unavailable" },
            { status: 500 }
          );
        for (const message of body.p_messages as UIMessage[]) {
          const index = session.messages.findIndex(
            (saved) => saved.id === message.id
          );
          if (index === -1) session.messages.push(message);
          else session.messages[index] = message;
        }
        return Response.json({ status: "ok", session });
      }
      if (name === "claim_chat_limit_admission")
        return Response.json({ allowed: true, claim_id: randomUUID() });
      if (name === "get_provider_key")
        return Response.json(
          body.p_provider === "openai" ? "fixture-provider-key" : null
        );
      if (name === "merge_ai_call_metadata") {
        const call = calls.find(
          (row) =>
            row.id === body.p_ai_call_id && row.user_id === body.p_user_id
        );
        if (call)
          call.metadata = {
            ...(call.metadata as Record<string, unknown>),
            ...(body.p_metadata_patch as Record<string, unknown>),
          };
        return Response.json(call ?? null);
      }
      throw new Error(`Unexpected RPC: ${name}`);
    }
    const matches = (row: Record<string, unknown>) =>
      [...url.searchParams].every(
        ([key, value]) =>
          !value.startsWith("eq.") || String(row[key]) === value.slice(3)
      );
    let rows: Record<string, unknown>[];
    switch (name) {
      case "control_continuations":
        rows = matches(ticket) ? [ticket] : [];
        break;
      case "control_sessions":
        rows = [session];
        break;
      case "external_agent_runs":
        rows = ticket.worker_run_ids.map((id) => ({
          id,
          user_id: userId,
          repo_id: repoId,
          status: "success",
          worktree_id: randomUUID(),
          error: null,
        }));
        break;
      case "repos":
        rows = [
          {
            id: repoId,
            user_id: userId,
            full_name: "example/fixture",
            owner: "example",
            name: "fixture",
            default_branch: "main",
            github_installation_id: null,
          },
        ];
        break;
      case "ai_calls":
        rows = calls.filter(matches);
        break;
      case "ai_call_events":
        if (req.method === "POST") {
          if (body.event_type === "cancelled") await nextEventLoopTurn();
          savedEvents.push(body);
        }
        rows = req.method === "POST" ? [{ id: randomUUID(), ...body }] : [];
        break;
      case "profiles":
      case "billing_accounts":
      case "sandboxes":
      case "orchestration_worktrees":
      case "limit_events":
        rows = [];
        break;
      default:
        throw new Error(`Unexpected table: ${name}`);
    }
    if (req.method === "POST" && name === "ai_calls") {
      const call = { id: randomUUID(), ...body };
      calls.push(call);
      rows = [call];
    }
    if (req.method === "PATCH")
      for (const row of rows) Object.assign(row, body);
    const single = req.headers.get("accept")?.includes("vnd.pgrst.object");
    return Response.json(single ? (rows[0] ?? null) : rows);
  };
  return {
    userId,
    session,
    ticket,
    calls,
    savedEvents,
    providerRequests,
    fetchBoundary,
    createListener,
    get closed() {
      return closed;
    },
    failProvider: () => {
      providerStatus = 401;
    },
    failCheckpoint: () => {
      failTranscript = true;
    },
    onProvider: (callback: () => Promise<void>) => {
      beforeProvider = callback;
    },
    cancel: () => {
      ticket.status = "cancelled";
      notification?.({
        table: "control_continuations",
        op: "UPDATE",
        user_id: userId,
        id: ticket.id,
      });
    },
  };
}

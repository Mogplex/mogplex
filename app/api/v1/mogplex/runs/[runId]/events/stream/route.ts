import { resolveApiKey } from "@/lib/auth/api-key";
import {
  createTableEventListener,
  type TableEventListener,
} from "@/lib/db/table-event-listener";
import { loadMogplexApiRunEvent } from "@/lib/mogplex-api/run-event";
import { parseMogplexApiListLimit } from "@/lib/mogplex-api/request";
import {
  mogplexApiError,
  resolveMogplexApiUser,
} from "@/lib/mogplex-api/response";
import {
  listMogplexApiRunEvents,
  type PresentedAiCallEvent,
} from "@/lib/mogplex-api/run-control";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;

const TERMINAL_EVENT_TYPES = new Set(["finished", "failed", "cancelled"]);

type RunEventsStreamDeps = {
  resolveApiKey: typeof resolveApiKey;
  listEvents: typeof listMogplexApiRunEvents;
  loadEvent: typeof loadMogplexApiRunEvent;
  createListener: () => Promise<TableEventListener>;
};

const defaultDeps: RunEventsStreamDeps = {
  resolveApiKey,
  listEvents: listMogplexApiRunEvents,
  loadEvent: loadMogplexApiRunEvent,
  createListener: createTableEventListener,
};

function encodeRun(encoder: TextEncoder, run: unknown) {
  return encoder.encode(`event: run\ndata: ${JSON.stringify(run)}\n\n`);
}

function encodeEvent(encoder: TextEncoder, event: PresentedAiCallEvent) {
  return encoder.encode(
    `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
  );
}

async function loadNextPendingEvent(input: {
  pendingIds: string[];
  seen: Set<string>;
  loadEvent: RunEventsStreamDeps["loadEvent"];
  userId: string;
  runId: string;
}): Promise<PresentedAiCallEvent | null> {
  for (;;) {
    const eventId = input.pendingIds.shift();
    if (!eventId) return null;
    if (input.seen.has(eventId)) continue;
    const event = await input.loadEvent({
      userId: input.userId,
      runId: input.runId,
      eventId,
    });
    if (event) return event;
  }
}

export function createMogplexApiRunEventsStreamGetHandler(
  overrides: Partial<RunEventsStreamDeps> = {}
) {
  const deps = { ...defaultDeps, ...overrides };

  return async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ runId: string }> }
  ): Promise<Response> {
    const user = await resolveMogplexApiUser(request, {
      resolveApiKey: deps.resolveApiKey,
    });
    if (!user.ok) return user.response;

    const { runId } = await params;
    const replayLimit = parseMogplexApiListLimit(
      request.nextUrl.searchParams.get("limit")
    );
    let initial;
    try {
      initial = await deps.listEvents({
        userId: user.userId,
        runId,
        limit: replayLimit,
      });
    } catch (error) {
      console.error(
        "[mogplex-api/runs] failed to open run event stream",
        error
      );
      return mogplexApiError("INTERNAL_ERROR", "Failed to stream events", 500);
    }
    if (!initial) {
      return mogplexApiError("NOT_FOUND", "Run not found", 404);
    }

    let listener: TableEventListener;
    try {
      listener = await deps.createListener();
    } catch (error) {
      console.error("[mogplex-api/runs] run event listener unavailable", error);
      return mogplexApiError("INTERNAL_ERROR", "Failed to stream events", 500);
    }

    const pendingIds: string[] = [];
    let wake: (() => void) | undefined;
    let listenerFailure: Error | undefined;
    listener.onNotification((notification) => {
      if (
        notification.table !== "ai_call_events" ||
        notification.op !== "INSERT" ||
        notification.user_id !== user.userId ||
        notification.ai_call_id !== initial.run.aiCallId ||
        !notification.id
      ) {
        return;
      }
      pendingIds.push(notification.id);
      wake?.();
    });
    listener.onError((error) => {
      listenerFailure = error;
      wake?.();
    });

    let replay = initial;
    try {
      replay =
        (await deps.listEvents({
          userId: user.userId,
          runId,
          limit: replayLimit,
        })) ?? initial;
    } catch (error) {
      await listener.end().catch(() => undefined);
      console.error(
        "[mogplex-api/runs] failed to replay run event stream",
        error
      );
      return mogplexApiError("INTERNAL_ERROR", "Failed to stream events", 500);
    }

    let closed = false;
    let draining = false;
    const seen = new Set<string>();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const encoder = new TextEncoder();

        const cleanup = async () => {
          if (closed) return;
          closed = true;
          wake = undefined;
          await listener.end().catch(() => undefined);
        };
        const close = async () => {
          await cleanup();
          try {
            controller.close();
          } catch {
            // The client already closed the stream.
          }
        };
        const fail = async (error: unknown) => {
          if (closed) return;
          console.error("[mogplex-api/runs] run event stream failed", error);
          await close();
        };
        const emit = async (event: PresentedAiCallEvent) => {
          if (closed || seen.has(event.id)) return false;
          seen.add(event.id);
          controller.enqueue(encodeEvent(encoder, event));
          if (TERMINAL_EVENT_TYPES.has(event.type)) {
            await close();
            return true;
          }
          return false;
        };
        const drain = async () => {
          if (draining || closed) return;
          draining = true;
          try {
            if (listenerFailure) throw listenerFailure;
            for (;;) {
              if (closed) return;
              const event = await loadNextPendingEvent({
                pendingIds,
                seen,
                loadEvent: deps.loadEvent,
                userId: user.userId,
                runId,
              });
              if (!event) return;
              if (await emit(event)) return;
            }
          } catch (error) {
            await fail(error);
          } finally {
            draining = false;
          }
        };

        wake = () => void drain();
        request.signal.addEventListener("abort", () => void cleanup());
        controller.enqueue(encoder.encode(": connected\n\n"));
        controller.enqueue(encodeRun(encoder, replay.run));
        for (const event of replay.events) {
          if (await emit(event)) return;
        }
        if (listenerFailure) {
          await fail(listenerFailure);
          return;
        }
        await drain();
      },
      cancel() {
        if (closed) return;
        closed = true;
        wake = undefined;
        void listener.end().catch(() => undefined);
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  };
}

export const GET = createMogplexApiRunEventsStreamGetHandler();

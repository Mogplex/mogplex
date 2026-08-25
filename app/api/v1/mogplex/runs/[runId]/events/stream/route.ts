import { resolveApiKey } from "@/lib/auth/api-key";
import {
  createTableEventListener,
  type TableEventListener,
} from "@/lib/db/table-event-listener";
import {
  listMogplexApiRunEventPage,
  loadMogplexApiRunEvent,
  loadMogplexApiRunEventStreamContext,
  MogplexApiRunEventCursorError,
  type MogplexApiRunEventCursor,
} from "@/lib/mogplex-api/run-event";
import { parseMogplexApiListLimit } from "@/lib/mogplex-api/request";
import {
  mogplexApiError,
  resolveMogplexApiUser,
} from "@/lib/mogplex-api/response";
import type { PresentedAiCallEvent } from "@/lib/mogplex-api/run-control";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;

const TERMINAL_EVENT_TYPES = new Set(["finished", "failed", "cancelled"]);
const STREAM_PAGE_LIMIT = 200;

type RunEventsStreamDeps = {
  resolveApiKey: typeof resolveApiKey;
  loadContext: typeof loadMogplexApiRunEventStreamContext;
  listPage: typeof listMogplexApiRunEventPage;
  loadEvent: typeof loadMogplexApiRunEvent;
  loadPendingEvent: typeof loadNextPendingEvent;
  createListener: () => Promise<TableEventListener>;
};

const defaultDeps: RunEventsStreamDeps = {
  resolveApiKey,
  loadContext: loadMogplexApiRunEventStreamContext,
  listPage: listMogplexApiRunEventPage,
  loadEvent: loadMogplexApiRunEvent,
  loadPendingEvent: loadNextPendingEvent,
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

function lastEventId(request: NextRequest) {
  return request.headers.get("last-event-id")?.trim() || null;
}

function throwListenerFailure(error: Error | undefined) {
  if (error) throw error;
}

function hasDrainWork(input: {
  failure?: Error;
  requested: boolean;
  pending: number;
}) {
  return Boolean(input.failure || input.requested || input.pending > 0);
}

async function loadNextPendingEvent(input: {
  pendingIds: string[];
  seen: Set<string>;
  loadEvent: RunEventsStreamDeps["loadEvent"];
  userId: string;
  aiCallId: string;
}): Promise<PresentedAiCallEvent | null> {
  for (;;) {
    const eventId = input.pendingIds.shift();
    if (!eventId) return null;
    if (input.seen.has(eventId)) continue;
    const event = await input.loadEvent({
      userId: input.userId,
      aiCallId: input.aiCallId,
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
    const resumeEventId = lastEventId(request);
    const replayLimit = parseMogplexApiListLimit(
      request.nextUrl.searchParams.get("limit")
    );
    let context;
    try {
      context = await deps.loadContext({
        userId: user.userId,
        runId,
        lastEventId: resumeEventId,
      });
    } catch (error) {
      if (error instanceof MogplexApiRunEventCursorError) {
        return mogplexApiError("BAD_REQUEST", error.message, 400);
      }
      console.error(
        "[mogplex-api/runs] failed to open run event stream",
        error
      );
      return mogplexApiError("INTERNAL_ERROR", "Failed to stream events", 500);
    }
    if (!context) {
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
    const getListenerFailure = () => listenerFailure;
    listener.onNotification((notification) => {
      if (
        notification.table !== "ai_call_events" ||
        notification.op !== "INSERT" ||
        notification.user_id !== user.userId ||
        notification.ai_call_id !== context.aiCallId ||
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

    let closed = false;
    let draining = false;
    let drainRequested = false;
    let replaying = true;
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
        const replay = async () => {
          let cursor: MogplexApiRunEventCursor | null = context.cursor;
          const latest = resumeEventId === null;
          for (;;) {
            const page = await deps.listPage({
              userId: user.userId,
              aiCallId: context.aiCallId,
              cursor,
              limit: latest ? replayLimit : STREAM_PAGE_LIMIT,
              latest,
            });
            const failure = getListenerFailure();
            if (failure) throw failure;
            for (const event of page.events) {
              if (await emit(event)) return true;
            }
            cursor = page.cursor ?? cursor;
            if (latest || !page.hasMore) return false;
          }
        };
        const drain = async () => {
          if (draining || closed) {
            drainRequested = true;
            return;
          }
          draining = true;
          try {
            do {
              drainRequested = false;
              throwListenerFailure(getListenerFailure());
              for (;;) {
                if (closed) return;
                const event = await deps.loadPendingEvent({
                  pendingIds,
                  seen,
                  loadEvent: deps.loadEvent,
                  userId: user.userId,
                  aiCallId: context.aiCallId,
                });
                throwListenerFailure(getListenerFailure());
                if (!event) break;
                if (await emit(event)) return;
              }
            } while (
              hasDrainWork({
                requested: drainRequested,
                pending: pendingIds.length,
              })
            );
          } catch (error) {
            await fail(error);
          } finally {
            draining = false;
            if (
              !closed &&
              hasDrainWork({
                failure: getListenerFailure(),
                requested: drainRequested,
                pending: pendingIds.length,
              })
            ) {
              void drain();
            }
          }
        };

        wake = () => {
          drainRequested = true;
          if (!replaying) void drain();
        };
        request.signal.addEventListener("abort", () => void cleanup());
        controller.enqueue(encoder.encode(": connected\n\n"));
        controller.enqueue(encodeRun(encoder, context.run));
        try {
          if (await replay()) return;
          replaying = false;
          await drain();
        } catch (error) {
          replaying = false;
          await fail(error);
        }
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

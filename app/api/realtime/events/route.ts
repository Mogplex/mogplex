import { NextResponse } from "next/server";
import { getResolvedAuth } from "@/lib/auth";
import {
  createTableEventListener,
  type TableEventListener,
} from "@/lib/db/table-event-listener";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABLE_NAME_PATTERN = /^[a-z_]+$/;

export type ListenerHandle = TableEventListener;

export type RealtimeEventsRouteDeps = {
  getResolvedAuth: typeof getResolvedAuth;
  createListener: () => Promise<ListenerHandle>;
};

export function createRealtimeEventsGetHandler(
  overrides: Partial<RealtimeEventsRouteDeps> = {}
) {
  const deps: RealtimeEventsRouteDeps = {
    getResolvedAuth,
    createListener: createTableEventListener,
    ...overrides,
  };

  return async function GET(request: Request): Promise<Response> {
    // E2e runs keep pages parked on `networkidle` waits, and a held-open SSE
    // stream means networkidle never fires — the whole suite stalls into the
    // job timeout. 204 tells EventSource to stop reconnecting entirely (per
    // the SSE spec), so under Playwright the hooks connect once and go quiet.
    // PLAYWRIGHT is never set on real deployments.
    if (process.env.PLAYWRIGHT === "1") {
      return new Response(null, { status: 204 });
    }

    const resolved = await deps.getResolvedAuth();
    if (!resolved?.profileId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const profileId = resolved.profileId;
    const url = new URL(request.url);
    const tablesParam = url.searchParams.get("tables");

    if (!tablesParam) {
      return NextResponse.json(
        { error: "Missing tables parameter" },
        { status: 400 }
      );
    }

    const tables = tablesParam.split(",").filter(Boolean);

    if (tables.length === 0) {
      return NextResponse.json(
        { error: "No valid tables specified" },
        { status: 400 }
      );
    }

    for (const table of tables) {
      if (!TABLE_NAME_PATTERN.test(table)) {
        return NextResponse.json(
          { error: `Invalid table name: ${table}` },
          { status: 400 }
        );
      }
    }

    const tableSet = new Set(tables);

    let listener: ListenerHandle | undefined;
    let pingInterval: ReturnType<typeof setInterval> | undefined;
    let closed = false;

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const encoder = new TextEncoder();

        const cleanup = async () => {
          if (closed) return;
          closed = true;
          if (pingInterval) {
            clearInterval(pingInterval);
            pingInterval = undefined;
          }
          if (listener) {
            try {
              await listener.end();
            } catch {
              // Ignore cleanup errors
            }
            listener = undefined;
          }
        };

        request.signal.addEventListener("abort", () => {
          void cleanup();
        });

        try {
          listener = await deps.createListener();

          // The client can abort while the listener connects; enqueueing into
          // the closed controller would throw, so tear down instead.
          if (request.signal.aborted || closed) {
            await cleanup();
            return;
          }

          listener.onNotification((payload) => {
            if (closed) return;

            // Filter: table must be in the requested set
            if (!tableSet.has(payload.table)) return;

            // Filter: user_id must match the authenticated user or be null/undefined
            // (null user_id = broadcast event, e.g. job_runs without user scope)
            if (payload.user_id && payload.user_id !== profileId) return;

            const event = {
              table: payload.table,
              op: payload.op,
            };

            try {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
              );
            } catch {
              // Stream closed
              void cleanup();
            }
          });

          // Send initial connection confirmation
          controller.enqueue(encoder.encode(": connected\n\n"));

          // Keepalive ping every 25 seconds
          pingInterval = setInterval(() => {
            if (closed) return;
            try {
              controller.enqueue(encoder.encode(": ping\n\n"));
            } catch {
              void cleanup();
            }
          }, 25_000);
        } catch (error) {
          console.error("[realtime-events] Listener setup failed:", error);
          await cleanup();
          try {
            controller.close();
          } catch {
            // Already closed by cancel().
          }
        }
      },

      cancel() {
        closed = true;
        if (pingInterval) {
          clearInterval(pingInterval);
        }
        if (listener) {
          void listener.end();
        }
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

export const GET = createRealtimeEventsGetHandler();

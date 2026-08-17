import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { getOrCreateBillingAccount } from "@/lib/billing/accounts";
import {
  createBillingAccountEventListener,
  type BillingAccountEventListener,
} from "@/lib/billing/account-event-listener";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolveProductResourceScope } from "@/lib/team-resource-scope";

export type {
  BillingAccountEventListener,
  BillingAccountEventNotification,
} from "@/lib/billing/account-event-listener";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The repository TypeScript target predates bigint literal syntax.
/* eslint-disable unicorn/prefer-bigint-literals */
const EVENT_PAGE_SIZE = 100;
const MAX_SEQUENCE = BigInt("9223372036854775807");
const ZERO_SEQUENCE = BigInt(0);

const EVENT_TYPES = new Set([
  "billing.summary.changed",
  "billing.capacity.change_pending",
  "billing.capacity.change_applied",
  "billing.capacity.change_failed",
  "billing.hosted_usage.added",
  "billing.account.status_changed",
] as const);

type BillingAccountEventType =
  | "billing.summary.changed"
  | "billing.capacity.change_pending"
  | "billing.capacity.change_applied"
  | "billing.capacity.change_failed"
  | "billing.hosted_usage.added"
  | "billing.account.status_changed";

export type BillingAccountEventRecord = {
  account_id: string;
  sequence: number | string;
  event_type: string;
  source_event_id: string;
  committed_at: string;
};

type BillingAccountEventsRouteDeps = {
  requireUserId: typeof requireUserId;
  resolveProductResourceScope: typeof resolveProductResourceScope;
  getOrCreateBillingAccount: typeof getOrCreateBillingAccount;
  loadEventsAfter: (input: {
    accountId: string;
    afterSequence: string;
    limit: number;
  }) => Promise<BillingAccountEventRecord[]>;
  createListener: () => Promise<BillingAccountEventListener>;
};

async function defaultLoadEventsAfter(input: {
  accountId: string;
  afterSequence: string;
  limit: number;
}): Promise<BillingAccountEventRecord[]> {
  const { data, error } = await supabaseAdmin
    .from("billing_account_events")
    .select("account_id, sequence, event_type, source_event_id, committed_at")
    .eq("account_id", input.accountId)
    .gt("sequence", input.afterSequence)
    .order("sequence", { ascending: true })
    .limit(input.limit);
  if (error) {
    throw new Error(`billing account event lookup failed: ${error.message}`);
  }
  return (data as BillingAccountEventRecord[] | null) ?? [];
}

function parseCursor(request: Request): string | null {
  const url = new URL(request.url);
  const raw =
    request.headers.get("last-event-id") ?? url.searchParams.get("after");
  if (raw === null || raw === "") return "0";
  if (!/^(0|[1-9]\d*)$/.test(raw)) return null;
  const parsed = BigInt(raw);
  return parsed <= MAX_SEQUENCE ? parsed.toString() : null;
}

function parseEvent(
  row: BillingAccountEventRecord,
  expectedAccountId: string
): {
  accountId: string;
  sequence: string;
  eventType: BillingAccountEventType;
  sourceEventId: string;
  committedAt: string;
} {
  if (row.account_id !== expectedAccountId) {
    throw new Error("billing account event crossed account scope");
  }
  const sequence = BigInt(row.sequence);
  if (sequence <= ZERO_SEQUENCE || sequence > MAX_SEQUENCE) {
    throw new Error("billing account event sequence is invalid");
  }
  if (!EVENT_TYPES.has(row.event_type as BillingAccountEventType)) {
    throw new Error("billing account event type is invalid");
  }
  if (!row.source_event_id || !Number.isFinite(Date.parse(row.committed_at))) {
    throw new Error("billing account event payload is invalid");
  }
  return {
    accountId: row.account_id,
    sequence: sequence.toString(),
    eventType: row.event_type as BillingAccountEventType,
    sourceEventId: row.source_event_id,
    committedAt: row.committed_at,
  };
}

function encodeEvent(
  encoder: TextEncoder,
  event: ReturnType<typeof parseEvent>
): Uint8Array {
  return encoder.encode(
    `id: ${event.sequence}\nevent: ${event.eventType}\ndata: ${JSON.stringify({
      accountId: event.accountId,
      sequence: event.sequence,
      sourceEventId: event.sourceEventId,
      committedAt: event.committedAt,
    })}\n\n`
  );
}

export function createBillingAccountEventsGetHandler(
  overrides: Partial<BillingAccountEventsRouteDeps> = {}
) {
  const deps: BillingAccountEventsRouteDeps = {
    requireUserId,
    resolveProductResourceScope,
    getOrCreateBillingAccount,
    loadEventsAfter: defaultLoadEventsAfter,
    createListener: createBillingAccountEventListener,
    ...overrides,
  };

  return async function GET(request: Request): Promise<Response> {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    const resolution = await deps.resolveProductResourceScope({
      request,
      userId,
    });
    if (!resolution.ok) {
      return NextResponse.json(
        { error: resolution.error },
        { status: resolution.status }
      );
    }

    const afterSequence = parseCursor(request);
    if (afterSequence === null) {
      return NextResponse.json(
        { error: "Invalid billing event cursor" },
        { status: 400 }
      );
    }

    let accountId: string;
    try {
      accountId = (await deps.getOrCreateBillingAccount(resolution.scope)).id;
    } catch (error) {
      console.error("[capacity-billing-events] account resolution failed", {
        scope: resolution.scope.kind,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return NextResponse.json(
        { error: "Billing events are unavailable" },
        { status: 500 }
      );
    }

    // Keep Playwright's network-idle waits finite. Production never sets this
    // variable. Exact account resolution intentionally runs first so this test
    // path exercises the same account boundary as the production stream.
    if (process.env.PLAYWRIGHT === "1") {
      return new Response(null, { status: 204 });
    }

    let listener: BillingAccountEventListener | undefined;
    let closed = false;
    let ready = false;
    let pending = false;
    let draining = false;
    let latestSequence = BigInt(afterSequence);

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const encoder = new TextEncoder();

        const cleanup = async () => {
          if (closed) return;
          closed = true;
          if (listener) {
            const activeListener = listener;
            listener = undefined;
            try {
              await activeListener.end();
            } catch {
              // The connection is already being discarded.
            }
          }
        };

        const fail = async (error: unknown) => {
          if (closed) return;
          console.error("[capacity-billing-events] stream failed", {
            accountId,
            error: error instanceof Error ? error.message : "Unknown error",
          });
          await cleanup();
          try {
            controller.close();
          } catch {
            // The client already closed the stream.
          }
        };

        const flushDurableEvents = async () => {
          for (;;) {
            if (closed) return;
            const sequenceBeforePage = latestSequence;
            const rows = await deps.loadEventsAfter({
              accountId,
              afterSequence: latestSequence.toString(),
              limit: EVENT_PAGE_SIZE,
            });
            if (closed) return;
            for (const row of rows) {
              const event = parseEvent(row, accountId);
              const sequence = BigInt(event.sequence);
              if (sequence <= latestSequence) continue;
              controller.enqueue(encodeEvent(encoder, event));
              latestSequence = sequence;
            }
            if (rows.length < EVENT_PAGE_SIZE) return;
            if (latestSequence === sequenceBeforePage) {
              throw new Error("billing account event replay did not advance");
            }
          }
        };

        const drainNotifications = async () => {
          if (!ready || draining || closed) return;
          draining = true;
          try {
            do {
              if (closed) return;
              pending = false;
              await flushDurableEvents();
            } while (pending);
          } catch (error) {
            await fail(error);
          } finally {
            draining = false;
          }
        };

        request.signal.addEventListener("abort", () => {
          void cleanup();
        });

        try {
          listener = await deps.createListener();
          if (request.signal.aborted || closed) {
            await cleanup();
            return;
          }
          listener.onNotification((notification) => {
            if (!/^\d+$/.test(notification.sequence)) return;
            const notificationSequence = BigInt(notification.sequence);
            if (
              closed ||
              notification.accountId !== accountId ||
              notificationSequence <= latestSequence ||
              notificationSequence > MAX_SEQUENCE
            ) {
              return;
            }
            pending = true;
            void drainNotifications();
          });
          controller.enqueue(encoder.encode(": connected\n\n"));
          await flushDurableEvents();
          ready = true;
          if (pending) void drainNotifications();
        } catch (error) {
          await fail(error);
        }
      },
      cancel() {
        if (closed) return;
        closed = true;
        if (listener) {
          const activeListener = listener;
          listener = undefined;
          void activeListener.end().catch(() => {
            // The connection is already being discarded.
          });
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

export const GET = createBillingAccountEventsGetHandler();

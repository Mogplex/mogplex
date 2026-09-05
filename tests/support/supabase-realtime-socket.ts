import { createClient } from "@supabase/supabase-js";

type Binding = {
  id: number;
  event: string;
  schema: string;
  table: string;
  filter: string;
};
type Frame = [string | null, string, string, string, Record<string, unknown>];

/** In-memory WebSocket peer for the real Supabase Realtime SDK wire protocol. */
export function supabaseRealtimeSocket(options: { rejectJoin?: boolean } = {}) {
  const sockets: FixtureSocket[] = [];
  let joined: Frame | undefined;
  let bindings: Binding[] = [];
  let leaves = 0;
  class FixtureSocket extends EventTarget {
    readonly CONNECTING = 0;
    readonly OPEN = 1;
    readonly CLOSING = 2;
    readonly CLOSED = 3;
    readyState = 0;
    protocol = "";
    url: string;
    onopen: ((event: Event) => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onclose: ((event: CloseEvent) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    constructor(address: string | URL) {
      super();
      this.url = String(address);
      sockets.push(this);
      queueMicrotask(() => {
        this.readyState = this.OPEN;
        this.onopen?.(new Event("open"));
      });
    }
    receive(frame: Frame) {
      this.onmessage?.(
        new MessageEvent("message", { data: JSON.stringify(frame) })
      );
    }
    send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
      if (typeof data !== "string")
        throw new Error("Expected a JSON subscription frame");
      const frame = JSON.parse(data) as Frame;
      if (frame[3] === "phx_join") {
        joined = frame;
        const config = frame[4].config as {
          postgres_changes: Omit<Binding, "id">[];
        };
        bindings = config.postgres_changes.map((binding, index) => ({
          ...binding,
          id: index + 1,
        }));
        queueMicrotask(() =>
          this.receive([
            frame[0],
            frame[1],
            frame[2],
            "phx_reply",
            {
              status: options.rejectJoin ? "error" : "ok",
              response: options.rejectJoin
                ? { reason: "subscription refused" }
                : { postgres_changes: bindings },
            },
          ])
        );
      } else if (frame[3] === "phx_leave") {
        leaves++;
        queueMicrotask(() =>
          this.receive([
            frame[0],
            frame[1],
            frame[2],
            "phx_reply",
            { status: "ok", response: {} },
          ])
        );
      }
    }
    close() {
      this.readyState = this.CLOSED;
      this.onclose?.(new Event("close") as CloseEvent);
    }
  }
  const client = createClient(
    "https://realtime.example.test",
    "fixture-service-role",
    {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { transport: FixtureSocket },
    }
  );
  return {
    client,
    get leaves() {
      return leaves;
    },
    emit(
      table: string,
      row: Record<string, unknown>,
      eventType: "UPDATE" | "DELETE" = "UPDATE"
    ) {
      if (!joined) throw new Error("Subscription has not joined");
      const binding = bindings.find((value) => value.table === table);
      if (!binding) throw new Error("No subscription for table");
      sockets[0].receive([
        joined[0],
        joined[1],
        joined[2],
        "postgres_changes",
        {
          ids: [binding.id],
          data: {
            schema: "public",
            table,
            type: eventType,
            commit_timestamp: new Date().toISOString(),
            errors: null,
            columns: Object.keys(row).map((name) => ({ name, type: "text" })),
            record: eventType === "DELETE" ? {} : row,
            old_record: eventType === "DELETE" ? row : {},
          },
        },
      ]);
    },
    disconnect() {
      sockets[0].onerror?.(new Event("error"));
    },
  };
}

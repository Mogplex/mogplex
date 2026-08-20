import type { Client as PgClient, Notification } from "pg";
import { getRuntimeUnpooledDatabaseUrl } from "@/lib/db/connection-urls";

export type TableEventPayload = {
  table: string;
  op: string;
  user_id?: string | null;
  id?: string | null;
};

export type TableEventListener = {
  onNotification: (handler: (payload: TableEventPayload) => void) => void;
  end: () => Promise<void>;
};

type TableEventClient = Pick<
  PgClient,
  "connect" | "query" | "on" | "off" | "end"
>;

type TableEventListenerFactoryDeps = {
  createClient: () => TableEventClient | Promise<TableEventClient>;
};

async function defaultCreateClient(): Promise<TableEventClient> {
  const { Client } = await import("pg");
  return new Client({
    connectionString: getRuntimeUnpooledDatabaseUrl(),
  });
}

function parseTableEvent(message: Notification): TableEventPayload | null {
  if (message.channel !== "mogplex_table_events" || !message.payload) {
    return null;
  }
  try {
    const payload = JSON.parse(message.payload) as Partial<TableEventPayload>;
    if (typeof payload.table !== "string" || typeof payload.op !== "string") {
      return null;
    }
    return {
      table: payload.table,
      op: payload.op,
      user_id: payload.user_id,
      id: payload.id,
    };
  } catch {
    return null;
  }
}

export function createTableEventListenerFactory(
  overrides: Partial<TableEventListenerFactoryDeps> = {}
): () => Promise<TableEventListener> {
  const deps: TableEventListenerFactoryDeps = {
    createClient: defaultCreateClient,
    ...overrides,
  };

  return async () => {
    const client = await deps.createClient();
    let notificationHandler: ((message: Notification) => void) | undefined;
    let ended = false;

    try {
      await client.connect();
      await client.query("LISTEN mogplex_table_events");
    } catch (error) {
      await client.end().catch(() => undefined);
      throw error;
    }

    return {
      onNotification: (handler) => {
        if (ended) return;
        if (notificationHandler) {
          client.off("notification", notificationHandler);
        }
        notificationHandler = (message) => {
          const payload = parseTableEvent(message);
          if (payload) handler(payload);
        };
        client.on("notification", notificationHandler);
      },
      end: async () => {
        if (ended) return;
        ended = true;
        if (notificationHandler) {
          client.off("notification", notificationHandler);
        }
        await client.end();
      },
    };
  };
}

export const createTableEventListener = createTableEventListenerFactory();

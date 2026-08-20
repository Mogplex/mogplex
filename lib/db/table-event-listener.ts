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
  onError: (handler: (error: Error) => void) => void;
  end: () => Promise<void>;
};

type TableEventClient = Pick<
  PgClient,
  "connect" | "query" | "on" | "off" | "end"
>;

type TableEventListenerFactoryDeps = {
  createClient: () => TableEventClient | Promise<TableEventClient>;
};

type SharedTableEventConnection = {
  client: TableEventClient;
  notificationHandlers: Set<(payload: TableEventPayload) => void>;
  errorHandlers: Set<(error: Error) => void>;
  notificationListener: (message: Notification) => void;
  errorListener: (error: Error) => void;
  endListener: () => void;
  leases: number;
  failed: boolean;
  failure: Error | null;
  closing: boolean;
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

  // Sharing limits Neon sessions by design. A connection failure fans out to
  // every lease, whose SSE or readiness consumer then reconnects.
  let sharedConnection: SharedTableEventConnection | null = null;
  let connecting: Promise<SharedTableEventConnection> | null = null;

  const closeConnection = async (connection: SharedTableEventConnection) => {
    if (connection.closing) return;
    connection.closing = true;
    if (sharedConnection === connection) sharedConnection = null;
    connection.client.off("notification", connection.notificationListener);
    connection.client.off("error", connection.errorListener);
    connection.client.off("end", connection.endListener);
    await connection.client.end();
  };

  const closeFailedConnection = (connection: SharedTableEventConnection) => {
    void closeConnection(connection).catch(() => undefined);
  };

  const connect = async () => {
    const client = await deps.createClient();
    const notificationHandlers = new Set<
      (payload: TableEventPayload) => void
    >();
    const errorHandlers = new Set<(error: Error) => void>();
    let connection!: SharedTableEventConnection;

    const fail = (error: Error) => {
      if (connection.failed || connection.closing) return;
      connection.failed = true;
      connection.failure = error;
      if (sharedConnection === connection) sharedConnection = null;
      for (const handler of errorHandlers) handler(error);
      // A pg error is not guaranteed to be followed by an `end` event.
      // Close explicitly so a failed shared client cannot outlive its leases.
      closeFailedConnection(connection);
    };
    const notificationListener = (message: Notification) => {
      const payload = parseTableEvent(message);
      if (!payload) return;
      for (const handler of notificationHandlers) handler(payload);
    };
    const errorListener = (error: Error) => fail(error);
    const endListener = () =>
      fail(new Error("Neon table event connection ended unexpectedly."));

    connection = {
      client,
      notificationHandlers,
      errorHandlers,
      notificationListener,
      errorListener,
      endListener,
      leases: 0,
      failed: false,
      failure: null,
      closing: false,
    };

    client.on("notification", notificationListener);
    client.on("error", errorListener);
    client.on("end", endListener);

    try {
      await client.connect();
      await client.query("LISTEN mogplex_table_events");
    } catch (error) {
      connection.closing = true;
      client.off("notification", notificationListener);
      client.off("error", errorListener);
      client.off("end", endListener);
      await client.end().catch(() => undefined);
      throw error;
    }

    return connection;
  };

  const getConnection = async () => {
    if (sharedConnection && !sharedConnection.failed) return sharedConnection;
    if (!connecting) {
      connecting = connect()
        .then((connection) => {
          sharedConnection = connection;
          return connection;
        })
        .finally(() => {
          connecting = null;
        });
    }
    return connecting;
  };

  return async () => {
    let connection = await getConnection();
    while (connection.failed || connection.closing) {
      connection = await getConnection();
    }
    connection.leases += 1;
    let notificationHandler: ((payload: TableEventPayload) => void) | null =
      null;
    let errorHandler: ((error: Error) => void) | null = null;
    let ended = false;

    return {
      onNotification: (handler) => {
        if (ended) return;
        if (notificationHandler) {
          connection.notificationHandlers.delete(notificationHandler);
        }
        notificationHandler = handler;
        connection.notificationHandlers.add(handler);
      },
      onError: (handler) => {
        if (ended) return;
        if (errorHandler) connection.errorHandlers.delete(errorHandler);
        errorHandler = handler;
        if (connection.failure) {
          handler(connection.failure);
          return;
        }
        connection.errorHandlers.add(handler);
      },
      end: async () => {
        if (ended) return;
        ended = true;
        if (notificationHandler) {
          connection.notificationHandlers.delete(notificationHandler);
        }
        if (errorHandler) connection.errorHandlers.delete(errorHandler);
        connection.leases -= 1;
        if (connection.leases === 0) await closeConnection(connection);
      },
    };
  };
}

export const createTableEventListener = createTableEventListenerFactory();

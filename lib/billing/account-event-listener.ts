import type { Client as PgClient, Notification } from "pg";
import { getRuntimeUnpooledDatabaseUrl } from "@/lib/db/connection-urls";

export type BillingAccountEventNotification = {
  accountId: string;
  sequence: string;
};

export type BillingAccountEventListener = {
  onNotification: (
    handler: (payload: BillingAccountEventNotification) => void
  ) => void;
  end: () => Promise<void>;
};

type BillingAccountEventClient = Pick<
  PgClient,
  "connect" | "query" | "on" | "off" | "end"
>;

type BillingAccountEventListenerFactoryDeps = {
  createClient: () =>
    | BillingAccountEventClient
    | Promise<BillingAccountEventClient>;
};

async function defaultCreateClient(): Promise<BillingAccountEventClient> {
  const { Client } = await import("pg");
  return new Client({
    connectionString: getRuntimeUnpooledDatabaseUrl(),
  });
}

function parseNotification(
  message: Notification
): BillingAccountEventNotification | null {
  if (
    message.channel !== "mogplex_billing_account_events" ||
    !message.payload
  ) {
    return null;
  }
  try {
    const parsed = JSON.parse(
      message.payload
    ) as Partial<BillingAccountEventNotification>;
    if (
      typeof parsed.accountId === "string" &&
      typeof parsed.sequence === "string" &&
      /^\d+$/.test(parsed.sequence)
    ) {
      return {
        accountId: parsed.accountId,
        sequence: parsed.sequence,
      };
    }
  } catch {
    // A malformed notification is ignored. Durable rows are replayed after
    // the next valid account notification or EventSource reconnect.
  }
  return null;
}

/**
 * Share one unpooled LISTEN connection across every billing event stream in a
 * Node runtime. The lifecycle chain serializes acquisition and release without
 * timers, so a connection cannot close while another stream acquires it.
 */
export function createBillingAccountEventListenerFactory(
  overrides: Partial<BillingAccountEventListenerFactoryDeps> = {}
): () => Promise<BillingAccountEventListener> {
  const deps: BillingAccountEventListenerFactoryDeps = {
    createClient: defaultCreateClient,
    ...overrides,
  };
  const subscribers = new Set<
    (payload: BillingAccountEventNotification) => void
  >();
  let client: BillingAccountEventClient | undefined;
  let clientNotificationHandler: ((message: Notification) => void) | undefined;
  let referenceCount = 0;
  let lifecycle: Promise<void> = Promise.resolve();

  const withinLifecycle = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = lifecycle.then(operation);
    lifecycle = result.then(() => undefined).catch(() => undefined);
    return result;
  };

  const acquire = () =>
    withinLifecycle(async () => {
      if (!client) {
        const candidate = await deps.createClient();
        const notificationHandler = (message: Notification) => {
          const payload = parseNotification(message);
          if (!payload) return;
          for (const subscriber of subscribers) subscriber(payload);
        };
        try {
          await candidate.connect();
          await candidate.query("LISTEN mogplex_billing_account_events");
          candidate.on("notification", notificationHandler);
        } catch (error) {
          try {
            await candidate.end();
          } catch {
            // The failed connection is already being discarded.
          }
          throw error;
        }
        client = candidate;
        clientNotificationHandler = notificationHandler;
      }
      referenceCount += 1;
      return client;
    });

  const release = (activeClient: BillingAccountEventClient) =>
    withinLifecycle(async () => {
      if (client !== activeClient || referenceCount === 0) return;
      referenceCount -= 1;
      if (referenceCount > 0) return;
      const endingClient = client;
      const notificationHandler = clientNotificationHandler;
      client = undefined;
      clientNotificationHandler = undefined;
      if (notificationHandler) {
        endingClient.off("notification", notificationHandler);
      }
      await endingClient.end();
    });

  return async () => {
    const activeClient = await acquire();
    let subscriber:
      | ((payload: BillingAccountEventNotification) => void)
      | undefined;
    let ended = false;

    return {
      onNotification: (handler) => {
        if (ended) return;
        if (subscriber) subscribers.delete(subscriber);
        subscriber = handler;
        subscribers.add(subscriber);
      },
      end: async () => {
        if (ended) return;
        ended = true;
        if (subscriber) subscribers.delete(subscriber);
        await release(activeClient);
      },
    };
  };
}

export const createBillingAccountEventListener =
  createBillingAccountEventListenerFactory();

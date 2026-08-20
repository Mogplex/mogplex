import { describe, expect, it, vi } from "vitest";
import { createTableEventListenerFactory } from "./table-event-listener";

function createClient() {
  const handlers = new Map<string, Set<(...args: never[]) => void>>();
  const client = {
    connect: vi.fn(async () => undefined),
    query: vi.fn(async () => ({ rows: [] })),
    on(event: string, handler: (...args: never[]) => void) {
      const listeners = handlers.get(event) ?? new Set();
      listeners.add(handler);
      handlers.set(event, listeners);
      return client;
    },
    off(event: string, handler: (...args: never[]) => void) {
      handlers.get(event)?.delete(handler);
      return client;
    },
    end: vi.fn(async () => undefined),
    emit(event: string, ...args: never[]) {
      for (const handler of handlers.get(event) ?? []) handler(...args);
    },
  };
  return client;
}

describe("table event listener", () => {
  it("multiplexes leases over one Neon LISTEN connection", async () => {
    const client = createClient();
    const createClientForListener = vi.fn(async () => client);
    const createListener = createTableEventListenerFactory({
      createClient: createClientForListener as never,
    });
    const first = await createListener();
    const second = await createListener();
    const firstPayloads: unknown[] = [];
    const secondPayloads: unknown[] = [];
    first.onNotification((payload) => firstPayloads.push(payload));
    second.onNotification((payload) => secondPayloads.push(payload));

    client.emit("notification", {
      channel: "mogplex_table_events",
      payload: JSON.stringify({ table: "sandboxes", op: "UPDATE", id: "1" }),
    } as never);

    expect(createClientForListener).toHaveBeenCalledTimes(1);
    expect(firstPayloads).toHaveLength(1);
    expect(secondPayloads).toHaveLength(1);
    await first.end();
    expect(client.end).not.toHaveBeenCalled();
    await second.end();
    expect(client.end).toHaveBeenCalledTimes(1);
  });

  it("notifies every lease when the shared connection fails", async () => {
    const client = createClient();
    const createListener = createTableEventListenerFactory({
      createClient: async () => client as never,
    });
    const first = await createListener();
    const second = await createListener();
    const firstErrors: Error[] = [];
    const secondErrors: Error[] = [];
    first.onError((error) => firstErrors.push(error));
    second.onError((error) => secondErrors.push(error));

    client.emit("error", new Error("connection lost") as never);

    expect(firstErrors[0]?.message).toBe("connection lost");
    expect(secondErrors[0]?.message).toBe("connection lost");
    await first.end();
    await second.end();
  });

  it("reports a connection failure registered after the event", async () => {
    const client = createClient();
    const createListener = createTableEventListenerFactory({
      createClient: async () => client as never,
    });
    const listener = await createListener();
    const errors: Error[] = [];

    client.emit("error", new Error("connection lost") as never);
    listener.onError((error) => errors.push(error));

    expect(errors[0]?.message).toBe("connection lost");
    await listener.end();
  });
});

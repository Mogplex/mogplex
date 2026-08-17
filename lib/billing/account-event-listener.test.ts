import type { Notification } from "pg";
import { describe, expect, it, vi } from "vitest";
import { createBillingAccountEventListenerFactory } from "./account-event-listener";

function createFakeClient(options: { listenFails?: boolean } = {}) {
  let notificationHandler: ((message: Notification) => void) | undefined;
  return {
    connect: vi.fn(async () => undefined),
    query: vi.fn(async () => {
      if (options.listenFails) throw new Error("LISTEN failed");
      return {};
    }),
    on: vi.fn((event: string, handler: (message: Notification) => void) => {
      if (event === "notification") notificationHandler = handler;
      return undefined;
    }),
    off: vi.fn((event: string, handler: (message: Notification) => void) => {
      if (event === "notification" && notificationHandler === handler) {
        notificationHandler = undefined;
      }
      return undefined;
    }),
    end: vi.fn(async () => undefined),
    emit: (payload: string) =>
      notificationHandler?.({
        channel: "mogplex_billing_account_events",
        payload,
        processId: 1,
      }),
  };
}

describe("billing account event listener", () => {
  it("shares one backend connection until the final stream ends", async () => {
    const client = createFakeClient();
    const createListener = createBillingAccountEventListenerFactory({
      createClient: () => client as never,
    });
    const first = await createListener();
    const second = await createListener();
    const firstEvents: string[] = [];
    const secondEvents: string[] = [];
    first.onNotification((event) => firstEvents.push(event.sequence));
    second.onNotification((event) => secondEvents.push(event.sequence));

    client.emit('{"accountId":"account-1","sequence":"7"}');

    expect(client.connect).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenCalledWith(
      "LISTEN mogplex_billing_account_events"
    );
    expect(firstEvents).toEqual(["7"]);
    expect(secondEvents).toEqual(["7"]);
    await first.end();
    expect(client.end).not.toHaveBeenCalled();
    await second.end();
    expect(client.end).toHaveBeenCalledTimes(1);
  });

  it("discards the client when LISTEN setup fails", async () => {
    const client = createFakeClient({ listenFails: true });
    const createListener = createBillingAccountEventListenerFactory({
      createClient: () => client as never,
    });

    await expect(createListener()).rejects.toThrow("LISTEN failed");
    expect(client.end).toHaveBeenCalledTimes(1);
  });
});

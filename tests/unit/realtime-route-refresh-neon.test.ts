import assert from "node:assert/strict";
import test from "node:test";
import { createElement, type ReactNode } from "react";
import { SWRConfig } from "swr";
import { installControlHookDom } from "../support/control-hook-dom";

test("Neon route refresh coalesces SSE updates and closes disabled subscriptions", async () => {
  const restoreDom = installControlHookDom();
  const previousBackend = process.env.NEXT_PUBLIC_MOGPLEX_DATA_BACKEND;
  const previousEventSource = Object.getOwnPropertyDescriptor(
    globalThis,
    "EventSource"
  );
  process.env.NEXT_PUBLIC_MOGPLEX_DATA_BACKEND = "neon";
  const sources: FakeEventSource[] = [];
  class FakeEventSource extends EventTarget {
    closed = false;
    constructor(readonly url: string) {
      super();
      sources.push(this);
    }
    close() {
      this.closed = true;
    }
  }
  Object.defineProperty(globalThis, "EventSource", {
    configurable: true,
    value: FakeEventSource,
  });
  const [{ renderHook, act }, { useRealtimeRouteRefresh }] = await Promise.all([
    import("@testing-library/react"),
    import("../../hooks/use-realtime-route-refresh"),
  ]);
  let invalidations = 0;
  const connections: string[] = [];
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(
      SWRConfig,
      {
        value: {
          provider: () => new Map(),
          fallback: { "/api/auth/user": { user: null } },
          revalidateOnMount: false,
          revalidateOnFocus: false,
          revalidateOnReconnect: false,
        },
      },
      children
    );
  const view = renderHook(
    ({ enabled }: { enabled: boolean }) =>
      useRealtimeRouteRefresh({
        channelName: "test-refresh",
        specs: [{ table: "repos" }],
        enabled,
        onInvalidate: () => {
          invalidations += 1;
        },
        onConnectionChange: (state) => connections.push(state),
      }),
    { initialProps: { enabled: true }, wrapper }
  );
  try {
    assert.equal(sources.length, 1);
    assert.match(sources[0].url, /\/api\/realtime\/events\?tables=repos/);
    assert.deepEqual(connections, ["connecting"]);
    await act(async () => {
      sources[0].dispatchEvent(new Event("open"));
      sources[0].dispatchEvent(
        new MessageEvent("message", {
          data: JSON.stringify({ table: "repos", op: "UPDATE" }),
        })
      );
      sources[0].dispatchEvent(
        new MessageEvent("message", {
          data: JSON.stringify({ table: "repos", op: "INSERT" }),
        })
      );
    });
    assert.equal(invalidations, 1);
    assert.deepEqual(connections, ["connecting", "connected"]);
    view.rerender({ enabled: false });
    assert.equal(sources[0].closed, true);
    await act(async () => {
      sources[0].dispatchEvent(
        new MessageEvent("message", {
          data: JSON.stringify({ table: "repos", op: "UPDATE" }),
        })
      );
    });
    assert.equal(invalidations, 1);
  } finally {
    view.unmount();
    restoreDom();
    if (previousEventSource)
      Object.defineProperty(globalThis, "EventSource", previousEventSource);
    else Reflect.deleteProperty(globalThis, "EventSource");
    if (previousBackend === undefined)
      delete process.env.NEXT_PUBLIC_MOGPLEX_DATA_BACKEND;
    else process.env.NEXT_PUBLIC_MOGPLEX_DATA_BACKEND = previousBackend;
  }
});

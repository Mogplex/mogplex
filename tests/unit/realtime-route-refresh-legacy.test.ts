import assert from "node:assert/strict";
import test from "node:test";
import { createElement, type ReactNode } from "react";
import { SWRConfig } from "swr";
import { installControlHookDom } from "../support/control-hook-dom";

test("unmounting during the legacy client import does not create a subscription", async () => {
  const restoreDom = installControlHookDom();
  const envKeys = [
    "NEXT_PUBLIC_MOGPLEX_DATA_BACKEND",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  ] as const;
  const previousEnv = envKeys.map((key) => process.env[key]);
  process.env.NEXT_PUBLIC_MOGPLEX_DATA_BACKEND = "supabase";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "public-test-anon-key";
  const previousSocket = Object.getOwnPropertyDescriptor(
    globalThis,
    "WebSocket"
  );
  let connections = 0;
  // The WebSocket is a network boundary. Never connect this test to a provider.
  class FakeSocket {
    readyState = 0;
    onopen: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onmessage: (() => void) | null = null;
    constructor() {
      connections += 1;
      throw new Error("An unmounted hook must not open a socket");
    }
    sent: string[] = [];
    send(data: string) {
      this.sent.push(data);
    }
    close() {
      this.readyState = 3;
      this.onclose?.();
    }
  }
  Object.defineProperty(globalThis, "WebSocket", {
    configurable: true,
    value: FakeSocket,
  });
  const [{ renderHook, act }, { useRealtimeRouteRefresh }] = await Promise.all([
    import("@testing-library/react"),
    import("../../hooks/use-realtime-route-refresh"),
  ]);
  const states: string[] = [];
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
    () =>
      useRealtimeRouteRefresh({
        channelName: "unmounted-import",
        specs: [{ table: "repos" }],
        onInvalidate: () => {},
        onConnectionChange: (state) => states.push(state),
      }),
    { wrapper }
  );
  view.unmount();
  try {
    await act(async () => {
      await import("../../lib/supabase/client");
    });
    assert.equal(connections, 0);
    assert.deepEqual(states, []);
  } finally {
    if (connections > 0) {
      const { createClient } = await import("../../lib/supabase/client");
      const client = createClient();
      await client.auth.getSession();
      await client.removeAllChannels();
      await client.auth.stopAutoRefresh();
    }
    restoreDom();
    if (previousSocket)
      Object.defineProperty(globalThis, "WebSocket", previousSocket);
    else Reflect.deleteProperty(globalThis, "WebSocket");
    for (const [index, key] of envKeys.entries()) {
      if (previousEnv[index] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[index];
    }
  }
});

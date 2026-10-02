import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { usePendingInitialMessage } from "../../components/control/use-pending-initial-message";

function installDom() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost",
  });
  const descriptors = Object.getOwnPropertyDescriptors(globalThis);
  const values = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  for (const [key, value] of Object.entries(values))
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  return () => {
    dom.window.close();
    for (const key of Object.keys(values)) {
      if (descriptors[key])
        Object.defineProperty(globalThis, key, descriptors[key]);
      else Reflect.deleteProperty(globalThis, key);
    }
  };
}

test("the readiness deadline never reports a live first response as unsent", async (t) => {
  const cleanup = installDom();
  const { renderHook, act } = await import("@testing-library/react");
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.now() });
  let finish!: () => void;
  let attempts = 0;
  const response = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const args = {
    sendMessage: () => {
      attempts++;
      return response;
    },
    getChatMessages: () => [],
    getChatError: () => undefined,
    clearChatError: () => {},
    messages: [],
    requestContext: {},
  };
  const view = renderHook(
    ({ status }) =>
      usePendingInitialMessage({ ...args, selectedMissionId: "live", status }),
    { initialProps: { status: "error" } }
  );
  try {
    await act(async () =>
      view.result.current.queue({
        missionId: "live",
        text: "Keep streaming",
        options: {
          model: "test/model",
          mode: "run",
          permissions: "Skip Permissions",
          files: [],
        },
      })
    );
    assert.equal(attempts, 0);
    await act(async () => t.mock.timers.tick(10_000));
    assert.equal(view.result.current.error, "Your first message was not sent");
    await act(async () => view.result.current.retry());
    await act(async () => view.rerender({ status: "ready" }));
    assert.equal(attempts, 1);
    await act(async () => view.rerender({ status: "streaming" }));
    await act(async () => t.mock.timers.tick(10_001));
    assert.equal(view.result.current.error, null);
    assert.equal(attempts, 1);
    await act(async () => {
      finish();
    });
    assert.equal(
      window.sessionStorage.getItem("mogplex.control.pendingInitial.live"),
      null
    );
  } finally {
    view.unmount();
    cleanup();
  }
});

test("an unavailable attachment store retains the text and waits for explicit Retry", async () => {
  const cleanup = installDom();
  const { renderHook, act, waitFor } = await import("@testing-library/react");
  window.sessionStorage.setItem(
    "mogplex.control.pendingInitial.evicted",
    JSON.stringify({
      missionId: "evicted",
      text: "Keep this request",
      options: {
        model: "test/model",
        mode: "run",
        permissions: "Skip Permissions",
        files: [
          {
            id: "missing",
            type: "file",
            mediaType: "text/plain",
            filename: "context.txt",
            url: "mogplex-pending-attachment:evicted:missing",
          },
        ],
      },
    })
  );
  const sent: unknown[] = [];
  const view = renderHook(() =>
    usePendingInitialMessage({
      selectedMissionId: "evicted",
      status: "ready",
      sendMessage: async (message) => {
        sent.push(message);
      },
      getChatMessages: () => [],
      getChatError: () => undefined,
      clearChatError: () => {},
      messages: [],
      requestContext: {},
    })
  );
  try {
    await waitFor(() =>
      assert.match(
        view.result.current.error ?? "",
        /We could not load some files/
      )
    );
    assert.equal(sent.length, 0);
    await act(async () => view.result.current.retry());
    await waitFor(() => assert.equal(view.result.current.error, null));
    assert.deepEqual(sent, [{ text: "Keep this request" }]);
  } finally {
    view.unmount();
    cleanup();
  }
});

test("a reloaded in-flight draft waits for Retry without claiming it was never delivered", async () => {
  const cleanup = installDom();
  const { renderHook, act, waitFor } = await import("@testing-library/react");
  window.sessionStorage.setItem(
    "mogplex.control.pendingInitial.accepted",
    JSON.stringify({
      missionId: "accepted",
      text: "Saved request",
      failed: false,
      options: {
        model: "test/model",
        mode: "run",
        permissions: "Skip Permissions",
        files: [],
      },
    })
  );
  let attempts = 0;
  const view = renderHook(() =>
    usePendingInitialMessage({
      selectedMissionId: "accepted",
      status: "ready",
      sendMessage: async () => {
        attempts++;
      },
      getChatMessages: () => [],
      getChatError: () => undefined,
      clearChatError: () => {},
      messages: [{ id: "previous-user-turn", role: "user" }],
      requestContext: {},
    })
  );
  try {
    await waitFor(() =>
      assert.equal(
        view.result.current.error,
        "We saved your first message. Retry sends it again."
      )
    );
    assert.equal(attempts, 0);
    await act(async () => view.result.current.retry());
    await waitFor(() => assert.equal(view.result.current.error, null));
    assert.equal(attempts, 1);
  } finally {
    view.unmount();
    cleanup();
  }
});

test("first-message recovery retains a failed draft across remounts and retries only once", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost",
  });
  const descriptors = Object.getOwnPropertyDescriptors(globalThis);
  const values = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  for (const [key, value] of Object.entries(values))
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  const { renderHook, act, waitFor } = await import("@testing-library/react");
  let attempts = 0;
  let blocked = true;
  let error: Error | undefined;
  const args = {
    status: "ready",
    sendMessage: async () => {
      attempts++;
      error = blocked ? new Error("Failed to fetch") : undefined;
    },
    clearChatError: () => {
      error = undefined;
    },
    getChatMessages: () => [],
    getChatError: () => error,
    messages: [],
    requestContext: {},
  };
  let view = renderHook(
    ({ id }) => usePendingInitialMessage({ ...args, selectedMissionId: id }),
    { initialProps: { id: "" } }
  );
  try {
    await act(async () =>
      view.result.current.queue({
        missionId: "saved",
        text: "Keep this",
        options: {
          model: "test/model",
          mode: "run",
          permissions: "Skip Permissions",
          files: [],
        },
      })
    );
    view.rerender({ id: "saved" });
    await waitFor(() =>
      assert.equal(view.result.current.error, "Your first message was not sent")
    );
    assert.equal(attempts, 1);
    view.unmount();
    view = renderHook(
      ({ id }) => usePendingInitialMessage({ ...args, selectedMissionId: id }),
      { initialProps: { id: "saved" } }
    );
    await waitFor(() =>
      assert.equal(view.result.current.error, "Your first message was not sent")
    );
    assert.equal(attempts, 1);
    blocked = false;
    await act(async () => view.result.current.retry());
    await waitFor(() => assert.equal(view.result.current.error, null));
    assert.equal(attempts, 2);
    assert.equal(
      dom.window.sessionStorage.getItem("mogplex.control.pendingInitial.saved"),
      null
    );
  } finally {
    view.unmount();
    dom.window.close();
    for (const key of Object.keys(values)) {
      if (descriptors[key])
        Object.defineProperty(globalThis, key, descriptors[key]);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

for (const scenario of [
  "answered follow-up",
  "different trailing draft",
  "failed original draft",
] as const) {
  test(`Retry preserves an ${scenario} user turn`, async () => {
    const cleanup = installDom();
    const { renderHook, act, waitFor } = await import("@testing-library/react");
    window.sessionStorage.setItem(
      "mogplex.control.pendingInitial.retry-turn",
      JSON.stringify({
        missionId: "retry-turn",
        text: "Original request",
        failed: true,
        options: {
          model: "test/model",
          mode: "run",
          permissions: "Skip Permissions",
          files: [],
        },
      })
    );
    const user = {
      id: "existing-user",
      role: "user",
      parts: [
        {
          type: "text",
          text:
            scenario === "failed original draft"
              ? "Original request"
              : "Different request",
        },
      ],
    };
    const messages =
      scenario === "answered follow-up"
        ? [
            user,
            {
              id: "reply",
              role: "assistant",
              parts: [{ type: "text", text: "Complete" }],
            },
          ]
        : [user];
    const sent: Array<{ messageId?: string }> = [];
    const view = renderHook(() =>
      usePendingInitialMessage({
        selectedMissionId: "retry-turn",
        status: "ready",
        messages,
        sendMessage: async (message) => {
          sent.push(message);
        },
        getChatMessages: () => [],
        getChatError: () => undefined,
        clearChatError: () => {},
        requestContext: {},
      })
    );
    try {
      await waitFor(() =>
        assert.equal(
          view.result.current.error,
          "Your first message was not sent"
        )
      );
      await act(async () => view.result.current.retry());
      await waitFor(() => assert.equal(sent.length, 1));
      assert.equal(
        sent[0].messageId,
        scenario === "failed original draft" ? "existing-user" : undefined
      );
    } finally {
      view.unmount();
      cleanup();
    }
  });
}

test("delivered first messages stay successful when draft cleanup fails", async () => {
  const cleanup = installDom();
  const { renderHook, act, waitFor } = await import("@testing-library/react");
  const storage = new Map<string, string>();
  let attempts = 0;
  let writes = 0;
  Object.defineProperty(window, "sessionStorage", {
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        writes++;
        storage.set(key, value);
      },
      removeItem: () => {
        throw new Error("Storage access revoked");
      },
    },
  });
  const view = renderHook(() =>
    usePendingInitialMessage({
      selectedMissionId: "delivered",
      status: "ready",
      sendMessage: async () => {
        attempts++;
      },
      getChatMessages: () => [],
      getChatError: () => undefined,
      clearChatError: () => {},
      messages: [],
      requestContext: {},
    })
  );
  try {
    await act(async () =>
      view.result.current.queue({
        missionId: "delivered",
        text: "Already delivered",
        options: {
          model: "test/model",
          mode: "run",
          permissions: "Skip Permissions",
          files: [],
        },
      })
    );
    await waitFor(() => assert.equal(attempts, 1));
    assert.equal(view.result.current.error, null);
    assert.equal(writes, 1, "cleanup failure must not save a failed draft");
    view.rerender();
    assert.equal(attempts, 1);
  } finally {
    view.unmount();
    cleanup();
  }
});

test("a stream error after assistant output retires the delivered draft using the live chat store", async () => {
  const cleanup = installDom();
  const { renderHook, act, waitFor } = await import("@testing-library/react");
  let liveMessages: Array<{
    id: string;
    role: string;
    parts: Array<{ type: string; text: string }>;
  }> = [];
  const view = renderHook(() =>
    usePendingInitialMessage({
      selectedMissionId: "partial",
      status: "ready",
      messages: [],
      getChatMessages: () => liveMessages,
      sendMessage: async () => {
        liveMessages = [
          {
            id: "user",
            role: "user",
            parts: [{ type: "text", text: "Delivered once" }],
          },
          {
            id: "assistant",
            role: "assistant",
            parts: [{ type: "text", text: "Partial answer" }],
          },
        ];
        throw new Error("Response interrupted");
      },
      getChatError: () => undefined,
      clearChatError: () => {},
      requestContext: {},
    })
  );
  try {
    await act(async () =>
      view.result.current.queue({
        missionId: "partial",
        text: "Delivered once",
        options: {
          model: "test/model",
          mode: "run",
          permissions: "Skip Permissions",
          files: [],
        },
      })
    );
    await waitFor(() => assert.equal(liveMessages.length, 2));
    assert.equal(view.result.current.error, null);
    assert.equal(
      window.sessionStorage.getItem("mogplex.control.pendingInitial.partial"),
      null
    );
  } finally {
    view.unmount();
    cleanup();
  }
});

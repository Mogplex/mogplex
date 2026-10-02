import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { usePendingInitialMessage } from "../../components/control/use-pending-initial-message";

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
    assert.equal(attempts, 2);
    blocked = false;
    await act(async () => view.result.current.retry());
    await waitFor(() => assert.equal(view.result.current.error, null));
    assert.equal(attempts, 3);
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

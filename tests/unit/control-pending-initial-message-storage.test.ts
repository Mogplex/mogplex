import assert from "node:assert/strict";
import test from "node:test";
import { usePendingInitialMessage } from "../../components/control/use-pending-initial-message";
import { installControlHookDom } from "../support/control-hook-dom";

for (const unavailable of ["attachments", "quota", "storage-access"]) {
  test(`first-message send and Retry stay available with unavailable ${unavailable}`, async () => {
    const cleanup = installControlHookDom();
    const { renderHook, act, waitFor } = await import("@testing-library/react");
    if (unavailable === "quota") {
      Object.defineProperty(window, "sessionStorage", {
        value: {
          getItem: () => null,
          setItem: () => {
            throw new Error("Quota exceeded");
          },
          removeItem: () => {},
        },
      });
    } else if (unavailable === "storage-access") {
      Object.defineProperty(window, "sessionStorage", {
        get: () => {
          throw new Error("Storage access blocked");
        },
      });
    }
    let attempts = 0;
    let error: Error | undefined;
    const view = renderHook(() =>
      usePendingInitialMessage({
        selectedMissionId: "unavailable",
        status: "ready",
        messages: [],
        getChatMessages: () => [],
        sendMessage: async () => {
          attempts++;
          error = attempts === 1 ? new Error("Transport failed") : undefined;
        },
        getChatError: () => error,
        clearChatError: () => {
          error = undefined;
        },
        requestContext: {},
      })
    );
    try {
      await act(async () =>
        view.result.current.queue({
          missionId: "unavailable",
          text: "Keep this in memory",
          options: {
            model: "test/model",
            mode: "run",
            permissions: "Skip Permissions",
            files:
              unavailable === "attachments"
                ? [
                    {
                      id: "file",
                      type: "file",
                      filename: "context.txt",
                      mediaType: "text/plain",
                      url: "data:text/plain;base64,Y29udGV4dA==",
                    },
                  ]
                : [],
          },
        })
      );
      await waitFor(() => assert.equal(attempts, 1));
      assert.match(
        view.result.current.error ?? "",
        /We could not save this draft/
      );
      await act(async () => view.result.current.retry());
      await waitFor(() => assert.equal(attempts, 2));
      assert.equal(view.result.current.error, null);
    } finally {
      view.unmount();
      cleanup();
    }
  });
}

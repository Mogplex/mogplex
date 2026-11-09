import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { RunActionButtons } from "../../components/panes/run-action-buttons";
import { installControlHookDom } from "../support/control-hook-dom";

test("RunActionButtons logs rejected actions instead of leaving an unhandled rejection", async () => {
  const cleanup = installControlHookDom();
  const errors: unknown[][] = [];
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args);
  };
  const { render, fireEvent, waitFor } = await import("@testing-library/react");
  const view = render(
    createElement(RunActionButtons, {
      run: {
        id: "job-1",
        status: "failed",
        cancelable: false,
        repairable: false,
        requeueable: true,
      },
      activeRunActions: {},
      onRunAction: async () => {
        throw new Error("network offline");
      },
    })
  );

  try {
    fireEvent.click(view.getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      assert.deepEqual(errors, [
        [
          "[flows] run action failed",
          { jobId: "job-1", action: "requeue", error: "network offline" },
        ],
      ])
    );
  } finally {
    view.unmount();
    console.error = originalConsoleError;
    cleanup();
  }
});

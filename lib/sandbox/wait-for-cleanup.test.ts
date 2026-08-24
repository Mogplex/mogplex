import { describe, expect, it, vi } from "vitest";
import { waitForSandboxCleanup } from "./wait-for-readiness";
import type {
  TableEventListener,
  TableEventPayload,
} from "@/lib/db/table-event-listener";

function createListener() {
  let handler: ((payload: TableEventPayload) => void) | undefined;
  const listener: TableEventListener & {
    emit: (payload: TableEventPayload) => void;
  } = {
    onNotification(next) {
      handler = next;
    },
    onError() {},
    end: vi.fn(async () => undefined),
    emit(payload) {
      handler?.(payload);
    },
  };
  return listener;
}

describe("waitForSandboxCleanup", () => {
  it("resumes from the matching database transition without polling", async () => {
    const listener = createListener();
    const loadSnapshot = vi
      .fn()
      .mockResolvedValueOnce({
        id: "sandbox-1",
        user_id: "user-1",
        status: "running",
      })
      .mockResolvedValueOnce({
        id: "sandbox-1",
        user_id: "user-1",
        status: "paused",
      });
    const result = waitForSandboxCleanup(
      { sandboxRecordId: "sandbox-1", userId: "user-1" },
      { createListener: async () => listener, loadSnapshot }
    );

    await vi.waitFor(() => expect(loadSnapshot).toHaveBeenCalledTimes(1));
    listener.emit({
      table: "sandboxes",
      op: "UPDATE",
      id: "sandbox-1",
      user_id: "user-1",
    });

    await expect(result).resolves.toMatchObject({
      kind: "complete",
      snapshot: { status: "paused" },
    });
    expect(loadSnapshot).toHaveBeenCalledTimes(2);
    expect(listener.end).toHaveBeenCalledTimes(1);
  });

  it("treats a removed predecessor as completed cleanup", async () => {
    const listener = createListener();
    await expect(
      waitForSandboxCleanup(
        { sandboxRecordId: "sandbox-1", userId: "user-1" },
        {
          createListener: async () => listener,
          loadSnapshot: async () => null,
        }
      )
    ).resolves.toEqual({ kind: "complete", snapshot: null });
  });

  it("returns a specific recovery action after the one-shot timeout", async () => {
    const listener = createListener();
    await expect(
      waitForSandboxCleanup(
        {
          sandboxRecordId: "sandbox-1",
          userId: "user-1",
          timeoutMs: 5,
        },
        {
          createListener: async () => listener,
          loadSnapshot: async () => ({
            id: "sandbox-1",
            user_id: "user-1",
            status: "running",
          }),
        }
      )
    ).resolves.toEqual({
      kind: "failed",
      message:
        "Sandbox cleanup did not finish automatically. Stop or delete the previous sandbox, then retry.",
    });
  });
});

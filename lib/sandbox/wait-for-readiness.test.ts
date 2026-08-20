import { describe, expect, it, vi } from "vitest";
import { waitForSandboxReadiness } from "./wait-for-readiness";
import type {
  TableEventListener,
  TableEventPayload,
} from "@/lib/db/table-event-listener";

function createListener() {
  let handler: ((payload: TableEventPayload) => void) | undefined;
  let errorHandler: ((error: Error) => void) | undefined;
  const listener: TableEventListener & {
    emit: (payload: TableEventPayload) => void;
    emitError: (error: Error) => void;
  } = {
    onNotification(next) {
      handler = next;
    },
    onError(next) {
      errorHandler = next;
    },
    end: vi.fn(async () => undefined),
    emit(payload) {
      handler?.(payload);
    },
    emitError(error) {
      errorHandler?.(error);
    },
  };
  return listener;
}

describe("waitForSandboxReadiness", () => {
  it("subscribes before reading and resolves from the matching Neon event", async () => {
    const listener = createListener();
    let firstRead!: () => void;
    const firstReadStarted = new Promise<void>((resolve) => {
      firstRead = resolve;
    });
    const loadSnapshot = vi
      .fn()
      .mockImplementationOnce(async () => {
        firstRead();
        return { id: "sandbox-1", user_id: "user-1", status: "installing" };
      })
      .mockResolvedValueOnce({
        id: "sandbox-1",
        user_id: "user-1",
        status: "running",
        health_status: "running",
        preview_url: "https://preview.example",
      });

    const result = waitForSandboxReadiness(
      { sandboxRecordId: "sandbox-1", userId: "user-1" },
      {
        createListener: async () => listener,
        loadSnapshot,
      }
    );
    await firstReadStarted;
    listener.emit({
      table: "sandboxes",
      op: "UPDATE",
      id: "sandbox-1",
      user_id: "user-1",
    });

    await expect(result).resolves.toMatchObject({
      kind: "ready",
      snapshot: { id: "sandbox-1", status: "running" },
    });
    expect(listener.end).toHaveBeenCalledTimes(1);
  });

  it("ignores unrelated events and reports a terminal failure", async () => {
    const listener = createListener();
    let firstRead!: () => void;
    const firstReadStarted = new Promise<void>((resolve) => {
      firstRead = resolve;
    });
    const loadSnapshot = vi
      .fn()
      .mockImplementationOnce(async () => {
        firstRead();
        return {
          id: "sandbox-1",
          user_id: "user-1",
          status: "installing",
        };
      })
      .mockResolvedValueOnce({
        id: "sandbox-1",
        user_id: "user-1",
        status: "stopped",
      });
    const result = waitForSandboxReadiness(
      { sandboxRecordId: "sandbox-1", userId: "user-1" },
      {
        createListener: async () => listener,
        loadSnapshot,
      }
    );
    await firstReadStarted;
    listener.emit({
      table: "sandboxes",
      op: "UPDATE",
      id: "sandbox-other",
      user_id: "user-1",
    });
    expect(loadSnapshot).toHaveBeenCalledTimes(1);
    listener.emit({
      table: "sandboxes",
      op: "UPDATE",
      id: "sandbox-1",
      user_id: "user-1",
    });

    await expect(result).resolves.toEqual({
      kind: "failed",
      message: "Sandbox stopped before it became ready.",
    });
  });

  it("closes the Neon listener when the caller aborts", async () => {
    const listener = createListener();
    const abort = new AbortController();
    const result = waitForSandboxReadiness(
      {
        sandboxRecordId: "sandbox-1",
        userId: "user-1",
        signal: abort.signal,
      },
      {
        createListener: async () => listener,
        loadSnapshot: async () => ({
          id: "sandbox-1",
          user_id: "user-1",
          status: "installing",
        }),
      }
    );
    abort.abort(new Error("client left"));

    await expect(result).rejects.toThrow("client left");
    expect(listener.end).toHaveBeenCalledTimes(1);
  });

  it("reconnects after the Neon listener disconnects", async () => {
    const firstListener = createListener();
    const secondListener = createListener();
    let firstRead!: () => void;
    const firstReadStarted = new Promise<void>((resolve) => {
      firstRead = resolve;
    });
    const loadSnapshot = vi
      .fn()
      .mockImplementationOnce(async () => {
        firstRead();
        return {
          id: "sandbox-1",
          user_id: "user-1",
          status: "installing",
        };
      })
      .mockResolvedValueOnce({
        id: "sandbox-1",
        user_id: "user-1",
        status: "running",
      });
    const createListenerForWait = vi
      .fn()
      .mockResolvedValueOnce(firstListener)
      .mockResolvedValueOnce(secondListener);
    const result = waitForSandboxReadiness(
      { sandboxRecordId: "sandbox-1", userId: "user-1" },
      {
        createListener: createListenerForWait,
        loadSnapshot,
      }
    );

    await firstReadStarted;
    firstListener.emitError(new Error("connection lost"));

    await expect(result).resolves.toMatchObject({ kind: "ready" });
    expect(createListenerForWait).toHaveBeenCalledTimes(2);
    expect(firstListener.end).toHaveBeenCalledTimes(1);
    expect(secondListener.end).toHaveBeenCalledTimes(1);
  });

  it("retries one transient snapshot read without polling", async () => {
    const listener = createListener();
    const loadSnapshot = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary Neon read failure"))
      .mockResolvedValueOnce({
        id: "sandbox-1",
        user_id: "user-1",
        status: "running",
      });

    await expect(
      waitForSandboxReadiness(
        { sandboxRecordId: "sandbox-1", userId: "user-1" },
        { createListener: async () => listener, loadSnapshot }
      )
    ).resolves.toMatchObject({ kind: "ready" });
    expect(loadSnapshot).toHaveBeenCalledTimes(2);
    expect(listener.end).toHaveBeenCalledTimes(1);
  });

  it("reconnects again after a second Neon listener disconnect", async () => {
    const firstListener = createListener();
    const secondListener = createListener();
    const thirdListener = createListener();
    let secondRead!: () => void;
    const secondReadStarted = new Promise<void>((resolve) => {
      secondRead = resolve;
    });
    const createListenerForWait = vi
      .fn()
      .mockResolvedValueOnce(firstListener)
      .mockResolvedValueOnce(secondListener)
      .mockResolvedValueOnce(thirdListener);
    const loadSnapshot = vi
      .fn()
      .mockResolvedValueOnce({
        id: "sandbox-1",
        user_id: "user-1",
        status: "installing",
      })
      .mockImplementationOnce(async () => {
        secondRead();
        return {
          id: "sandbox-1",
          user_id: "user-1",
          status: "installing",
        };
      })
      .mockResolvedValueOnce({
        id: "sandbox-1",
        user_id: "user-1",
        status: "running",
      });
    const result = waitForSandboxReadiness(
      { sandboxRecordId: "sandbox-1", userId: "user-1" },
      { createListener: createListenerForWait, loadSnapshot }
    );

    await vi.waitFor(() => expect(loadSnapshot).toHaveBeenCalledTimes(1));
    firstListener.emitError(new Error("first connection lost"));
    await secondReadStarted;
    secondListener.emitError(new Error("second connection lost"));

    await expect(result).resolves.toMatchObject({ kind: "ready" });
    expect(createListenerForWait).toHaveBeenCalledTimes(3);
    expect(firstListener.end).toHaveBeenCalledTimes(1);
    expect(secondListener.end).toHaveBeenCalledTimes(1);
    expect(thirdListener.end).toHaveBeenCalledTimes(1);
  });

  it("reads an authoritative snapshot after exhausting listener reconnects", async () => {
    const listeners = Array.from({ length: 4 }, createListener);
    const createListenerForWait = vi.fn();
    for (const listener of listeners) {
      createListenerForWait.mockResolvedValueOnce(listener);
    }
    const loadSnapshot = vi.fn(async () => ({
      id: "sandbox-1",
      user_id: "user-1",
      status: "installing",
    }));
    const result = waitForSandboxReadiness(
      { sandboxRecordId: "sandbox-1", userId: "user-1" },
      { createListener: createListenerForWait, loadSnapshot }
    );

    for (const [index, listener] of listeners.entries()) {
      await vi.waitFor(() =>
        expect(createListenerForWait).toHaveBeenCalledTimes(index + 1)
      );
      listener.emitError(new Error(`connection lost ${index + 1}`));
    }

    await expect(result).rejects.toThrow("connection lost 4");
    expect(loadSnapshot).toHaveBeenCalledTimes(5);
    for (const listener of listeners) {
      expect(listener.end).toHaveBeenCalledTimes(1);
    }
  });

  it("ends an event-driven wait after its one-shot safety timeout", async () => {
    const listener = createListener();
    const result = waitForSandboxReadiness(
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
          status: "installing",
        }),
      }
    );

    await expect(result).resolves.toEqual({
      kind: "failed",
      message: "Sandbox did not become ready before the wait timed out.",
    });
    expect(listener.end).toHaveBeenCalledTimes(1);
  });

  it("does not let listener cleanup failures replace the readiness result", async () => {
    const listener = createListener();
    listener.end = vi.fn(async () => {
      throw new Error("listener cleanup failed");
    });

    await expect(
      waitForSandboxReadiness(
        { sandboxRecordId: "sandbox-1", userId: "user-1" },
        {
          createListener: async () => listener,
          loadSnapshot: async () => ({
            id: "sandbox-1",
            user_id: "user-1",
            status: "running",
          }),
        }
      )
    ).resolves.toMatchObject({ kind: "ready" });
    expect(listener.end).toHaveBeenCalledTimes(1);
  });
});

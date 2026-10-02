import { afterEach, expect, it, vi } from "vitest";
import {
  createPendingInitialMessageDeadline,
  loadPendingInitialMessage,
  removePendingInitialMessage,
  savePendingInitialMessage,
  type PendingInitialMessage,
} from "./pending-initial-message";

afterEach(() => vi.useRealTimers());
it("reports a first message waiting in error after ten seconds", () => {
  vi.useFakeTimers();
  const failed = vi.fn();
  const deadline = createPendingInitialMessageDeadline(failed);
  vi.advanceTimersByTime(9_999);
  expect(failed).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(failed).toHaveBeenCalledOnce();
  deadline.cancel();
});
it("clears the readiness deadline on lifecycle cleanup", () => {
  vi.useFakeTimers();
  const failed = vi.fn();
  createPendingInitialMessageDeadline(failed).cancel();
  vi.advanceTimersByTime(10_000);
  expect(failed).not.toHaveBeenCalled();
});
it("keeps the prompt and attachment references across a storage round trip until success", async () => {
  const entries = new Map<string, string>();
  const storage = {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
    removeItem: (key: string) => {
      entries.delete(key);
    },
  };
  const pending: PendingInitialMessage = {
    missionId: "saved",
    text: "Keep this request",
    options: {
      model: "test/model",
      mode: "run",
      permissions: "Skip Permissions",
      files: [
        {
          id: "file-1",
          type: "file",
          mediaType: "text/plain",
          filename: "context.txt",
          url: "data:text/plain;base64,Y29udGV4dA==",
        },
      ],
    },
  };
  const urls = new Map<string, string>();
  const attachments = {
    put: async (key: string, url: string) => {
      urls.set(key, url);
    },
    get: async (key: string) => urls.get(key) ?? null,
    remove: async (key: string) => {
      urls.delete(key);
    },
  };
  await savePendingInitialMessage(storage, pending, attachments);
  expect([...entries.values()].join("")).not.toContain("data:text/plain");
  expect(
    await loadPendingInitialMessage(storage, "saved", attachments)
  ).toEqual(pending);
  expect(
    await loadPendingInitialMessage(storage, "other", attachments)
  ).toBeNull();
  await removePendingInitialMessage(storage, "saved", attachments);
  expect(urls.size).toBe(0);
  expect(
    await loadPendingInitialMessage(storage, "saved", attachments)
  ).toBeNull();
  entries.set("mogplex.control.pendingInitial.bad", "invalid-json");
  expect(
    await loadPendingInitialMessage(storage, "bad", attachments)
  ).toBeNull();
  await expect(
    removePendingInitialMessage(storage, "bad", attachments)
  ).resolves.toBeUndefined();
});

it("preserves the saved text when an attachment cannot be restored", async () => {
  const pending: PendingInitialMessage = {
    missionId: "evicted",
    text: "Keep the saved request",
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
  };
  const storage = {
    getItem: () => JSON.stringify(pending),
    setItem: () => {},
    removeItem: () => {},
  };
  const attachments = {
    put: async () => {},
    get: async () => null,
    remove: async () => {},
  };
  const restored = await loadPendingInitialMessage(
    storage,
    "evicted",
    attachments
  );
  expect(restored?.text).toBe(pending.text);
  expect(restored?.options.files).toEqual([]);
  expect(restored?.failed).toBe(true);
  expect(restored?.attachmentsMissing).toBe(true);
});

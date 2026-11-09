import assert from "node:assert/strict";
import test from "node:test";
import { installControlHookDom } from "../support/control-hook-dom";

const cleanupDom = installControlHookDom();
test.after(cleanupDom);

test("session persistence coalesces writes and keeps the latest state", async () => {
  const writes: Array<[string, string]> = [];
  globalThis.localStorage = {
    getItem: () => null,
    setItem: (name, value) => {
      writes.push([name, value]);
    },
    removeItem: () => {},
    clear: () => {},
    key: () => null,
    length: 0,
  };
  const { sessionPersistStorage } =
    await import("../../hooks/session-persist-storage");

  sessionPersistStorage.setItem("sessions", "first");
  sessionPersistStorage.setItem("sessions", "latest");
  sessionPersistStorage.setItem("other", "other-value");
  assert.equal(writes.length, 0);

  await new Promise((resolve) => setTimeout(resolve, 125));
  assert.deepEqual(writes, [
    ["sessions", "latest"],
    ["other", "other-value"],
  ]);
});

test("session persistence isolates failed keys and flushes on visibilitychange", async () => {
  const writes: Array<[string, string]> = [];
  const errors: unknown[][] = [];
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args);
  };
  globalThis.localStorage = {
    getItem: () => null,
    setItem: (name, value) => {
      if (name === "quota-exceeded") {
        throw new Error("storage full");
      }
      writes.push([name, value]);
    },
    removeItem: () => {},
    clear: () => {},
    key: () => null,
    length: 0,
  };
  const { sessionPersistStorage } =
    await import("../../hooks/session-persist-storage");

  try {
    sessionPersistStorage.setItem("quota-exceeded", "first");
    sessionPersistStorage.setItem("healthy", "second");
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    window.dispatchEvent(new window.Event("visibilitychange"));
    assert.deepEqual(writes, []);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    window.dispatchEvent(new window.Event("visibilitychange"));

    assert.deepEqual(writes, [["healthy", "second"]]);
    assert.deepEqual(errors, [
      [
        "[session-persist] failed to write",
        { name: "quota-exceeded", error: "storage full" },
      ],
    ]);
  } finally {
    console.error = originalConsoleError;
  }
});

test("session persistence reads pending values and flushes or removes them on pagehide", async () => {
  const values = new Map<string, string>([["sessions", "previous"]]);
  const writes: Array<[string, string]> = [];
  globalThis.localStorage = {
    getItem: (name) => values.get(name) ?? null,
    setItem: (name, value) => {
      values.set(name, value);
      writes.push([name, value]);
    },
    removeItem: (name) => {
      values.delete(name);
    },
    clear: () => values.clear(),
    key: () => null,
    length: 0,
  };
  const { sessionPersistStorage } =
    await import("../../hooks/session-persist-storage");

  sessionPersistStorage.setItem("sessions", "latest");
  assert.equal(sessionPersistStorage.getItem("sessions"), "latest");
  window.dispatchEvent(new window.Event("pagehide"));
  assert.deepEqual(writes, [["sessions", "latest"]]);

  sessionPersistStorage.setItem("sessions", "must-not-resurrect");
  sessionPersistStorage.removeItem("sessions");
  window.dispatchEvent(new window.Event("pagehide"));
  assert.equal(sessionPersistStorage.getItem("sessions"), null);
  assert.deepEqual(writes, [["sessions", "latest"]]);
});

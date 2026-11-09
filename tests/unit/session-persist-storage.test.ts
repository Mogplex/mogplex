import assert from "node:assert/strict";
import test from "node:test";

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

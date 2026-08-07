import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  loadSlackEventTask,
  restoreFetch,
  sleep,
} from "./helpers/slack-event-task-fixtures";

after(() => {
  restoreFetch();
});

test("createDebouncedSlackUpdater coalesces rapid updates within the interval", async () => {
  const { createDebouncedSlackUpdater } = await loadSlackEventTask();

  const sentTexts: string[] = [];
  let now = 1_700_000_000_000;
  const push = createDebouncedSlackUpdater({
    botToken: "xoxb",
    channel: "C",
    ts: "T",
    updateMessage: async (_token, input) => {
      sentTexts.push(input.text);
      return { channel: input.channel, ts: input.ts };
    },
    minIntervalMs: 1_000,
    now: () => now,
  });

  await push("step 1");
  await sleep(0);
  assert.deepEqual(sentTexts, ["step 1"]);

  await push("step 1");
  assert.equal(sentTexts.length, 1);

  await push("step 2");
  assert.equal(sentTexts.length, 1);

  now += 1_500;
  await push("step 3");
  await sleep(0);
  assert.deepEqual(sentTexts, ["step 1", "step 3"]);
});

test("createDebouncedSlackUpdater flush waits for an in-flight update", async () => {
  const { createDebouncedSlackUpdater } = await loadSlackEventTask();

  const updateGate: { release?: () => void } = {};
  const sentTexts: string[] = [];
  const push = createDebouncedSlackUpdater({
    botToken: "xoxb",
    channel: "C",
    ts: "T",
    updateMessage: async (_token, input) => {
      await new Promise<void>((resolve) => {
        updateGate.release = resolve;
      });
      sentTexts.push(input.text);
      return { channel: input.channel, ts: input.ts };
    },
    minIntervalMs: 1,
    now: () => 1_700_000_000_000,
  });

  await push("partial");
  const flushed = push.flush();
  await sleep(0);
  assert.deepEqual(sentTexts, []);
  assert.ok(updateGate.release);
  updateGate.release();
  await flushed;
  assert.deepEqual(sentTexts, ["partial"]);
});

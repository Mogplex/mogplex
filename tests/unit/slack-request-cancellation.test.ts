import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  loadSlackEventTask,
  restoreFetch,
  baseInstallation,
  basePayload,
  mappedAttribution,
} from "./helpers/slack-event-task-fixtures";

after(restoreFetch);
test("a stopped conversational request aborts the model and clears controls without posting an answer", async () => {
  const { runSlackEventTask } = await loadSlackEventTask();
  const abort = new AbortController();
  const posts: string[] = [];
  const edits: Array<{ text: string; blocks?: unknown[] }> = [];
  const result = await runSlackEventTask(basePayload, {
    getInstallation: async () => baseInstallation,
    getBotToken: async () => "fixture-token",
    resolveSlackAttribution: async () => mappedAttribution(),
    loadOrCreateConversation: async () => ({
      id: "conversation",
      user_id: "user-mogplex",
      messages: [],
      model: null,
      title: null,
    }),
    resolveRepoContext: async () => null,
    resolveModelPreference: async () => null,
    runtimeSignal: abort.signal,
    postMessage: async (_token, input) => {
      posts.push(input.text);
      return { channel: input.channel, ts: "2.1" };
    },
    updateMessage: async (_token, input) => {
      edits.push(input);
      return { channel: input.channel, ts: input.ts };
    },
    runAgent: async (input) => {
      assert.ok(input.abortSignal);
      abort.abort();
      input.abortSignal.throwIfAborted();
      throw new Error("Unreachable");
    },
  });
  assert.equal(result.outcome, "request_cancelled");
  assert.equal(posts.length, 1);
  assert.equal(edits.at(-1)?.text, "_Request stopped._");
  assert.doesNotMatch(JSON.stringify(edits.at(-1)), /Stop request/);
});

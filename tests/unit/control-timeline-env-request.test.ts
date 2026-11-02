import assert from "node:assert/strict";
import test from "node:test";
import type { UIMessage } from "ai";
import { buildCombinedTimeline } from "../../components/control/build-combined-timeline";
import { toolActivityLabel } from "../../lib/control/turn-progress";

function assistant(parts: unknown[]): UIMessage {
  return { id: "assistant-1", role: "assistant", parts } as UIMessage;
}

const request = (output: unknown, state = "output-available") => ({
  type: "tool-project_env_request",
  toolCallId: "env-1",
  state,
  input: { names: ["API_KEY", "NODE_ENV"] },
  output,
});

test("control timeline turns a variable request into a Set variables card", () => {
  const events = buildCombinedTimeline(undefined, [
    assistant([
      request({
        ok: true,
        repoId: "repo-1",
        requested: ["API_KEY", "NODE_ENV"],
        missing: ["API_KEY"],
        reason: "Checkout needs a key.",
      }),
    ]),
  ]);

  assert.deepEqual(events, [
    {
      kind: "env_request",
      id: '["assistant-1","part:0","event"]',
      messageId: "assistant-1",
      label: "VARIABLES",
      time: "now",
      body: "Checkout needs a key.",
      repoId: "repo-1",
      names: ["API_KEY", "NODE_ENV"],
      missing: ["API_KEY"],
    },
  ]);
});

test("control timeline shows a refused variable request as a failure, not a card", () => {
  const events = buildCombinedTimeline(undefined, [
    assistant([request({ error: "NOT-OK is not a valid variable name." })]),
  ]);

  assert.equal(events.length, 1);
  assert.equal(events[0]?.kind, "fail");
  assert.equal(events[0]?.body, "Variable request failed");
});

test("control timeline redacts credentials the model put in a request reason", () => {
  const events = buildCombinedTimeline(undefined, [
    assistant([
      request({
        ok: true,
        repoId: "repo-1",
        requested: ["API_KEY"],
        missing: ["API_KEY"],
        reason: "Use ghs_installationToken123 until the key is set.",
      }),
    ]),
  ]);

  assert.doesNotMatch(String(events[0]?.body), /installationToken123/);
  assert.match(String(events[0]?.body), /redacted/);
});

test("a running variable request reads as requesting variables", () => {
  assert.equal(
    toolActivityLabel("project_env_request"),
    "Requesting variables"
  );
});

test("control timeline keeps a running variable request as tool activity", () => {
  const events = buildCombinedTimeline(undefined, [
    assistant([request(undefined, "input-available")]),
  ]);

  assert.equal(events.length, 1);
  assert.equal(events[0]?.kind, "tool");
});

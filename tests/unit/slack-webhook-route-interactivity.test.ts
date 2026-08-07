import assert from "node:assert/strict";
import test from "node:test";
import {
  SIGNING_SECRET,
  loadSlackWebhookRoute,
  signedHeaders,
} from "./helpers/slack-webhook-route-fixtures";

test("parses interactivity form payloads and dispatches them", async () => {
  const { createSlackWebhookPostHandler } = await loadSlackWebhookRoute();

  const payload = {
    type: "block_actions",
    team: { id: "T123" },
    user: { id: "U1" },
  };
  const rawBody = new URLSearchParams({
    payload: JSON.stringify(payload),
  }).toString();

  const dispatched: unknown[] = [];
  const deferred: Array<() => void | Promise<void>> = [];
  const handler = createSlackWebhookPostHandler({
    getSigningSecret: () => SIGNING_SECRET,
    dispatch: (input) => {
      dispatched.push(input);
    },
    scheduleAfterResponse: (work) => {
      deferred.push(work);
    },
  });

  const response = await handler(
    new Request("http://localhost/api/webhooks/slack", {
      method: "POST",
      body: rawBody,
      headers: {
        ...signedHeaders(rawBody, {
          contentType: "application/x-www-form-urlencoded",
        }),
      },
    })
  );

  // Interactivity work is deferred until *after* the ack so a slow cancel
  // doesn't trip Slack's ~3s timeout (see issue #399).
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(dispatched.length, 0);
  assert.equal(deferred.length, 1);

  await deferred[0]();
  assert.equal(dispatched.length, 1);
  const [interaction] = dispatched as Array<{
    kind: string;
    body: { type: string };
  }>;
  assert.equal(interaction.kind, "interactivity");
  assert.equal(interaction.body.type, "block_actions");
});

test("rejects interactivity form payloads without a payload field", async () => {
  const { createSlackWebhookPostHandler } = await loadSlackWebhookRoute();

  const rawBody = "not_payload=oops";
  const handler = createSlackWebhookPostHandler({
    getSigningSecret: () => SIGNING_SECRET,
  });

  const response = await handler(
    new Request("http://localhost/api/webhooks/slack", {
      method: "POST",
      body: rawBody,
      headers: {
        ...signedHeaders(rawBody, {
          contentType: "application/x-www-form-urlencoded",
        }),
      },
    })
  );

  assert.equal(response.status, 400);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  SIGNING_SECRET,
  loadSlackWebhookRoute,
  signedHeaders,
} from "./helpers/slack-webhook-route-fixtures";

for (const command of ["/mogplex", "/harness"]) {
  test(`acknowledges verified ${command} before deferred dispatch`, async () => {
    const { createSlackWebhookPostHandler } = await loadSlackWebhookRoute();
    const rawBody = new URLSearchParams({
      command,
      text: "model openai/gpt-5.4",
      team_id: "T123",
      channel_id: "C123",
      user_id: "U123",
      response_url: "https://hooks.slack.test/response",
      trigger_id: "trigger-1",
    }).toString();
    const deferred: Array<() => void | Promise<void>> = [];
    const dispatched: unknown[] = [];
    const handler = createSlackWebhookPostHandler({
      getSigningSecret: () => SIGNING_SECRET,
      dispatch: (input) => {
        dispatched.push(input);
      },
      scheduleAfterResponse: (work) => deferred.push(work),
    });

    const response = await handler(
      new Request("http://localhost/api/webhooks/slack", {
        method: "POST",
        body: rawBody,
        headers: signedHeaders(rawBody, {
          contentType: "application/x-www-form-urlencoded",
        }),
      })
    );

    assert.equal(response.status, 200);
    assert.equal(await response.text(), "");
    assert.equal(dispatched.length, 0);
    assert.equal(deferred.length, 1);
    await deferred[0]();
    assert.deepEqual(dispatched, [
      {
        kind: "command",
        rawBody,
        body: {
          command,
          text: "model openai/gpt-5.4",
          teamId: "T123",
          channelId: "C123",
          slackUserId: "U123",
          responseUrl: "https://hooks.slack.test/response",
          triggerId: "trigger-1",
        },
      },
    ]);
  });
}

test("keeps form interactivity parsing separate from slash commands", async () => {
  const { createSlackWebhookPostHandler } = await loadSlackWebhookRoute();
  const rawBody = new URLSearchParams({
    command: "/mogplex",
    text: "model",
  }).toString();
  const handler = createSlackWebhookPostHandler({
    getSigningSecret: () => SIGNING_SECRET,
  });
  const response = await handler(
    new Request("http://localhost/api/webhooks/slack", {
      method: "POST",
      body: rawBody,
      headers: signedHeaders(rawBody, {
        contentType: "application/x-www-form-urlencoded",
      }),
    })
  );
  assert.equal(response.status, 200);
  assert.match(await response.text(), /could not read this command/i);
});

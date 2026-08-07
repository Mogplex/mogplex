import assert from "node:assert/strict";
import test from "node:test";
import {
  SIGNING_SECRET,
  loadSlackWebhookRoute,
  signedHeaders,
} from "./helpers/slack-webhook-route-fixtures";

test("dispatches event_callback payloads and acks 200", async () => {
  const { createSlackWebhookPostHandler } = await loadSlackWebhookRoute();

  const body = JSON.stringify({
    type: "event_callback",
    team_id: "T123",
    event_id: "Ev999",
    event: {
      type: "app_mention",
      channel: "C1",
      user: "U1",
      text: "<@UBOT> hello",
      ts: "1700000000.000100",
    },
  });

  const dispatched: unknown[] = [];
  const handler = createSlackWebhookPostHandler({
    getSigningSecret: () => SIGNING_SECRET,
    dispatch: (input) => {
      dispatched.push(input);
    },
  });

  const response = await handler(
    new Request("http://localhost/api/webhooks/slack", {
      method: "POST",
      body,
      headers: {
        ...signedHeaders(body),
        "content-type": "application/json",
      },
    })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(dispatched.length, 1);
  const [event] = dispatched as Array<{ kind: string }>;
  assert.equal(event.kind, "event");
});

test("acks and ignores event callbacks without complete identities", async () => {
  const { createSlackWebhookPostHandler } = await loadSlackWebhookRoute();
  const dispatched: unknown[] = [];
  const handler = createSlackWebhookPostHandler({
    getSigningSecret: () => SIGNING_SECRET,
    dispatch: (input) => {
      dispatched.push(input);
    },
  });

  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };
  try {
    for (const payload of [
      {
        type: "event_callback",
        team_id: "T123",
        event: { type: "app_mention" },
      },
      {
        type: "event_callback",
        team_id: " ",
        event_id: "Ev999",
        event: { type: "app_mention" },
      },
    ]) {
      const body = JSON.stringify(payload);
      const response = await handler(
        new Request("http://localhost/api/webhooks/slack", {
          method: "POST",
          body,
          headers: {
            ...signedHeaders(body),
            "content-type": "application/json",
          },
        })
      );

      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true });
    }
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(dispatched.length, 0);
  assert.deepEqual(warnings, [
    [
      "[slack-webhook] ignoring incomplete event identity",
      {
        hasTeamId: true,
        hasEventId: false,
        eventType: "app_mention",
      },
    ],
    [
      "[slack-webhook] ignoring incomplete event identity",
      {
        hasTeamId: false,
        hasEventId: true,
        eventType: "app_mention",
      },
    ],
  ]);
});

test("returns 503 when event dispatch is missing", async () => {
  const { createSlackWebhookPostHandler } = await loadSlackWebhookRoute();

  const body = JSON.stringify({
    type: "event_callback",
    team_id: "T123",
    event_id: "Ev999",
    event: {
      type: "app_mention",
      channel: "C1",
      user: "U1",
      text: "<@UBOT> hello",
      ts: "1700000000.000100",
    },
  });

  const originalError = console.error;
  console.error = () => undefined;
  try {
    const handler = createSlackWebhookPostHandler({
      getSigningSecret: () => SIGNING_SECRET,
      dispatch: undefined,
    });

    const response = await handler(
      new Request("http://localhost/api/webhooks/slack", {
        method: "POST",
        body,
        headers: {
          ...signedHeaders(body),
          "content-type": "application/json",
        },
      })
    );

    assert.equal(response.status, 503);
  } finally {
    console.error = originalError;
  }
});

test("buildSlackThreadConcurrencyKey scopes Trigger runs to one Slack thread", async () => {
  const { buildSlackThreadConcurrencyKey } = await loadSlackWebhookRoute();

  assert.equal(
    buildSlackThreadConcurrencyKey({
      teamId: "T123",
      channelId: "C1",
      threadTs: "1700000000.000100",
    }),
    "slack-thread:T123:C1:1700000000.000100"
  );
});

test("supports non-mention messages in direct conversations and only thread replies in channels", async () => {
  const { isSupportedSlackEvent } = await loadSlackWebhookRoute();

  for (const channelType of ["channel", "group"] as const) {
    assert.equal(
      isSupportedSlackEvent({
        type: "message",
        channel_type: channelType,
        channel: "C1",
        user: "U1",
        text: "confirmed",
        ts: "1700000001.000100",
        thread_ts: "1700000000.000100",
      }),
      true
    );
  }
  for (const channelType of ["im", "mpim"] as const) {
    assert.equal(
      isSupportedSlackEvent({
        type: "message",
        channel_type: channelType,
        channel: "D1",
        user: "U1",
        text: "hello",
        ts: "1700000001.000100",
      }),
      true
    );
  }
  for (const channelType of ["channel", "group"] as const) {
    assert.equal(
      isSupportedSlackEvent({
        type: "message",
        channel_type: channelType,
        channel: "C1",
        user: "U1",
        text: "top-level noise",
        ts: "1700000001.000100",
      }),
      false
    );
  }
});

test("maps supported Slack image files into the task payload", async () => {
  const { buildSlackEventTaskPayload } = await loadSlackWebhookRoute();

  const payload = buildSlackEventTaskPayload({
    type: "event_callback",
    team_id: "T123",
    event_id: "Ev999",
    event: {
      type: "message",
      channel_type: "im",
      channel: "D1",
      user: "U1",
      text: "what does this say?",
      ts: "1700000000.000100",
      files: [
        {
          id: "F1",
          mimetype: "image/png",
          url_private_download: "https://files.slack.com/files-pri/T-F1/png",
          name: "screenshot.png",
          size: 1234,
        },
      ],
    },
  });

  assert.equal(payload?.attachments?.length, 1);
  assert.deepEqual(payload?.attachments?.[0], {
    id: "F1",
    mimetype: "image/png",
    urlPrivateDownload: "https://files.slack.com/files-pri/T-F1/png",
    name: "screenshot.png",
    sizeBytes: 1234,
  });
});

test("filters unsupported and external Slack files from the task payload", async () => {
  const { buildSlackEventTaskPayload } = await loadSlackWebhookRoute();

  const originalWarn = console.warn;
  const warnings: Array<{ reason?: string }> = [];
  console.warn = (_message?: unknown, details?: unknown) => {
    warnings.push((details ?? {}) as { reason?: string });
  };
  try {
    const payload = buildSlackEventTaskPayload({
      type: "event_callback",
      team_id: "T123",
      event_id: "Ev999",
      event: {
        type: "message",
        channel_type: "im",
        channel: "D1",
        user: "U1",
        text: "check this",
        ts: "1700000000.000100",
        files: [
          {
            id: "Ftxt",
            mimetype: "text/plain",
            url_private_download:
              "https://files.slack.com/files-pri/T-Ftxt/txt",
            name: "notes.txt",
            size: 100,
          },
          {
            id: "Fext",
            mimetype: "image/png",
            url_private_download:
              "https://files.slack.com/files-pri/T-Fext/png",
            name: "drive.png",
            size: 100,
            filetype: "external",
          },
          {
            id: "Fnourl",
            mimetype: "image/webp",
            name: "missing-url.webp",
            size: 100,
          },
        ],
      },
    });

    assert.equal(payload?.attachments, undefined);
    assert.equal(payload?.attachmentDroppedCount, 3);
    assert.deepEqual(
      warnings.map((warning) => warning.reason),
      ["mimetype", "external", "no_url"]
    );
  } finally {
    console.warn = originalWarn;
  }
});

test("caps Slack image attachments at four", async () => {
  const { buildSlackEventTaskPayload } = await loadSlackWebhookRoute();

  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const payload = buildSlackEventTaskPayload({
      type: "event_callback",
      team_id: "T123",
      event_id: "Ev999",
      event: {
        type: "app_mention",
        channel: "C1",
        user: "U1",
        text: "<@UBOT> inspect",
        ts: "1700000000.000100",
        files: Array.from({ length: 5 }, (_, index) => ({
          id: `F${index}`,
          mimetype: "image/jpeg",
          url_private_download: `https://files.slack.com/files-pri/T-F${index}/jpg`,
          name: `shot-${index}.jpg`,
          size: 1000,
        })),
      },
    });

    assert.equal(payload?.attachments?.length, 4);
    assert.equal(payload?.attachmentDroppedCount, 1);
    assert.deepEqual(payload?.attachmentNotices, [
      { reason: "count_cap", count: 1 },
    ]);
  } finally {
    console.warn = originalWarn;
  }
});

test("returns a retryable error when event dispatch fails", async () => {
  const { createSlackWebhookPostHandler } = await loadSlackWebhookRoute();

  const body = JSON.stringify({
    type: "event_callback",
    team_id: "T123",
    event_id: "Ev999",
    event: { type: "app_mention" },
  });

  const handler = createSlackWebhookPostHandler({
    getSigningSecret: () => SIGNING_SECRET,
    dispatch: async () => {
      throw new Error("intentional");
    },
  });

  const originalError = console.error;
  console.error = () => {};
  try {
    const response = await handler(
      new Request("http://localhost/api/webhooks/slack", {
        method: "POST",
        body,
        headers: {
          ...signedHeaders(body),
          "content-type": "application/json",
        },
      })
    );
    assert.equal(response.status, 503);
  } finally {
    console.error = originalError;
  }
});

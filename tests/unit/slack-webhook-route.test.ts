import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

// Deterministic test fixture — clearly synthetic, not a real Slack secret.
const SIGNING_SECRET = ["test", "slack", "signing", "secret"].join("-");

async function loadSlackWebhookRoute() {
  process.env.SLACK_SIGNING_SECRET ||= SIGNING_SECRET;
  return import("../../app/api/webhooks/slack/route");
}

function signedHeaders(rawBody: string, opts: { contentType?: string } = {}) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const base = `v0:${timestamp}:${rawBody}`;
  const signature = `v0=${crypto
    .createHmac("sha256", SIGNING_SECRET)
    .update(base)
    .digest("hex")}`;
  const headers: Record<string, string> = {
    "x-slack-request-timestamp": timestamp,
    "x-slack-signature": signature,
  };
  if (opts.contentType) headers["content-type"] = opts.contentType;
  return headers;
}

test("rejects requests with an invalid signature", async () => {
  const { createSlackWebhookPostHandler } = await loadSlackWebhookRoute();

  const handler = createSlackWebhookPostHandler({
    getSigningSecret: () => SIGNING_SECRET,
  });

  const response = await handler(
    new Request("http://localhost/api/webhooks/slack", {
      method: "POST",
      body: "{}",
      headers: {
        "content-type": "application/json",
        "x-slack-request-timestamp": Math.floor(Date.now() / 1000).toString(),
        "x-slack-signature": "v0=deadbeef",
      },
    })
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Invalid signature" });
});

test("returns 503 when the signing secret is not configured", async () => {
  const { createSlackWebhookPostHandler } = await loadSlackWebhookRoute();

  const handler = createSlackWebhookPostHandler({
    getSigningSecret: () => null,
  });

  const response = await handler(
    new Request("http://localhost/api/webhooks/slack", {
      method: "POST",
      body: "{}",
    })
  );

  assert.equal(response.status, 503);
});

test("echoes the challenge for url_verification handshakes", async () => {
  const { createSlackWebhookPostHandler } = await loadSlackWebhookRoute();

  const body = JSON.stringify({
    type: "url_verification",
    challenge: "challenge-token-abc",
  });

  const handler = createSlackWebhookPostHandler({
    getSigningSecret: () => SIGNING_SECRET,
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
  assert.deepEqual(await response.json(), { challenge: "challenge-token-abc" });
});

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

test("rejects oversized payloads before parsing", async () => {
  const { createSlackWebhookPostHandler, SLACK_WEBHOOK_MAX_BODY_BYTES } =
    await loadSlackWebhookRoute();

  const huge = "a".repeat(SLACK_WEBHOOK_MAX_BODY_BYTES + 1);

  const handler = createSlackWebhookPostHandler({
    getSigningSecret: () => SIGNING_SECRET,
  });

  const response = await handler(
    new Request("http://localhost/api/webhooks/slack", {
      method: "POST",
      body: huge,
      headers: {
        "x-slack-request-timestamp": Math.floor(Date.now() / 1000).toString(),
        "x-slack-signature": "v0=ignored",
        "content-type": "application/json",
      },
    })
  );

  assert.equal(response.status, 413);
});

test("rejects payloads that exceed the byte limit with multibyte text", async () => {
  const { createSlackWebhookPostHandler, SLACK_WEBHOOK_MAX_BODY_BYTES } =
    await loadSlackWebhookRoute();

  const huge = "€".repeat(Math.floor(SLACK_WEBHOOK_MAX_BODY_BYTES / 3) + 1);
  assert.ok(huge.length < SLACK_WEBHOOK_MAX_BODY_BYTES);
  assert.ok(Buffer.byteLength(huge, "utf8") > SLACK_WEBHOOK_MAX_BODY_BYTES);

  const handler = createSlackWebhookPostHandler({
    getSigningSecret: () => SIGNING_SECRET,
  });

  const response = await handler(
    new Request("http://localhost/api/webhooks/slack", {
      method: "POST",
      body: huge,
      headers: {
        "x-slack-request-timestamp": Math.floor(Date.now() / 1000).toString(),
        "x-slack-signature": "v0=ignored",
        "content-type": "application/json",
      },
    })
  );

  assert.equal(response.status, 413);
});

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  SIGNING_SECRET,
  loadSlackWebhookRoute,
  signedHeaders,
} from "./helpers/slack-webhook-route-fixtures";
import { loadGithubWebhookRoute } from "./helpers/github-webhook-route-fixtures";

const NATIVE_URL = "https://api.trigger.dev/webhooks/synthetic-test";

async function withNativeEnv(run: () => Promise<void>) {
  const keys = [
    "TRIGGER_SLACK_WEBHOOK_URL",
    "TRIGGER_GITHUB_WEBHOOK_URL",
    "GITHUB_WEBHOOK_SECRET",
    "MOGPLEX_DATA_BACKEND",
  ] as const;
  const old = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  process.env.TRIGGER_SLACK_WEBHOOK_URL = NATIVE_URL;
  process.env.TRIGGER_GITHUB_WEBHOOK_URL = NATIVE_URL;
  process.env.GITHUB_WEBHOOK_SECRET = SIGNING_SECRET;
  process.env.MOGPLEX_DATA_BACKEND = "supabase";
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) {
      if (old[key] === undefined) delete process.env[key];
      else process.env[key] = old[key];
    }
  }
}

function command(text = "status") {
  return new URLSearchParams({
    command: "/mogplex",
    text,
    team_id: "T1",
    channel_id: "C1",
    user_id: "U1",
    response_url: "https://hooks.slack.test/response",
    trigger_id: "trigger-1",
  }).toString();
}

test("activated Slack forwarding waits for hosted receipt and never schedules duplicate local dispatch", async () => {
  await withNativeEnv(async () => {
    const { createSlackWebhookPostHandler } = await loadSlackWebhookRoute();
    let accept: (response: Response) => void = (response) => {
      throw new Error(`Unexpected receipt: ${response.status}`);
    };
    let localWork = 0;
    let acknowledged = false;
    const raw = command();
    const hosted = new Promise<Response>((resolve) => {
      accept = resolve;
    });
    globalThis.fetch = async (input, init) => {
      assert.equal(String(input), NATIVE_URL);
      assert.equal(init?.body, raw);
      assert.equal(
        new Headers(init?.headers).get("x-slack-signature"),
        signedHeaders(raw)["x-slack-signature"]
      );
      return hosted;
    };
    const handler = createSlackWebhookPostHandler({
      getSigningSecret: () => SIGNING_SECRET,
      dispatch: () => {
        localWork++;
      },
      scheduleAfterResponse: () => {
        localWork++;
      },
    });
    const pending = handler(
      new Request("https://app.test/api/webhooks/slack", {
        method: "POST",
        body: raw,
        headers: signedHeaders(raw, {
          contentType: "application/x-www-form-urlencoded",
        }),
      })
    ).then((response) => {
      acknowledged = true;
      return response;
    });
    await Promise.resolve();
    assert.equal(acknowledged, false);
    accept(new Response(null, { status: 200 }));
    const response = await pending;
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "");
    assert.equal(localWork, 0);
  });
});

test("activated Slack rejects invalid signatures before forwarding and returns 503 on ambiguous receipt", async () => {
  await withNativeEnv(async () => {
    const { createSlackWebhookPostHandler } = await loadSlackWebhookRoute();
    let attempts = 0;
    let localWork = 0;
    globalThis.fetch = async () => {
      attempts++;
      throw new Error("timeout after acceptance");
    };
    const handler = createSlackWebhookPostHandler({
      getSigningSecret: () => SIGNING_SECRET,
      dispatch: () => {
        localWork++;
      },
      scheduleAfterResponse: () => {
        localWork++;
      },
    });
    const raw = command();
    const request = (signature: string) =>
      new Request("https://app.test/api/webhooks/slack", {
        method: "POST",
        body: raw,
        headers: {
          ...signedHeaders(raw, {
            contentType: "application/x-www-form-urlencoded",
          }),
          "x-slack-signature": signature,
        },
      });
    assert.equal((await handler(request("v0=invalid"))).status, 401);
    assert.equal(attempts, 0);
    assert.equal(
      (await handler(request(signedHeaders(raw)["x-slack-signature"]))).status,
      503
    );
    assert.equal(attempts, 1);
    assert.equal(localWork, 0);
  });
});

test("activated Slack preserves immediate help and short-lived modal/unfurl paths", async () => {
  await withNativeEnv(async () => {
    const { createSlackWebhookPostHandler } = await loadSlackWebhookRoute();
    const deferred: Array<() => void | Promise<void>> = [];
    const dispatched: string[] = [];
    globalThis.fetch = async () => {
      throw new Error("deadline-sensitive paths must stay at edge");
    };
    const handler = createSlackWebhookPostHandler({
      getSigningSecret: () => SIGNING_SECRET,
      dispatch: (input) => {
        dispatched.push(input.kind);
      },
      scheduleAfterResponse: (work) => deferred.push(work),
    });
    for (const text of ["help", "issues create"]) {
      const raw = command(text);
      const response = await handler(
        new Request("https://app.test/api/webhooks/slack", {
          method: "POST",
          body: raw,
          headers: signedHeaders(raw, {
            contentType: "application/x-www-form-urlencoded",
          }),
        })
      );
      assert.equal(response.status, 200);
      if (text === "help") assert.match(await response.text(), /response_type/);
    }
    const raw = JSON.stringify({
      type: "event_callback",
      team_id: "T1",
      event_id: "E1",
      event: { type: "entity_details_requested", trigger_id: "fresh-trigger" },
    });
    assert.equal(
      (
        await handler(
          new Request("https://app.test/api/webhooks/slack", {
            method: "POST",
            body: raw,
            headers: signedHeaders(raw, { contentType: "application/json" }),
          })
        )
      ).status,
      200
    );
    assert.equal(deferred.length, 2);
    for (const work of deferred) await work();
    assert.deepEqual(dispatched, ["command", "event"]);
  });
});

test("native Slack runtime validation ignores bots/malformed events and preserves conversation identity", async () => {
  await loadSlackWebhookRoute();
  const { parseNativeSlackEvent } =
    await import("../../app/api/webhooks/slack/_lib/native-input");
  const event = {
    type: "event_callback",
    team_id: "T1",
    event_id: "E1",
    event: {
      type: "message",
      channel: "C1",
      channel_type: "im",
      user: "U1",
      text: "hello",
      ts: "1",
      thread_ts: "0",
    },
  };
  const parsed = parseNativeSlackEvent(event);
  assert.equal(parsed?.kind, "event");
  if (parsed?.kind !== "event") throw new Error("event required");
  assert.equal(parsed.body.team_id, "T1");
  assert.equal(parsed.body.event.thread_ts, "0");
  assert.equal(parseNativeSlackEvent({ ...event, team_id: "" }), null);
  assert.equal(
    parseNativeSlackEvent({ ...event, event: { ...event.event, files: {} } }),
    null
  );
  assert.equal(
    parseNativeSlackEvent({
      ...event,
      event: { ...event.event, bot_id: "B1" },
    }),
    null
  );
  for (const actionId of [
    "mogplex_checkpoint_revise",
    "mogplex_view_changes",
    "mogplex_run_details",
    "new_unreviewed_action",
  ]) {
    assert.equal(
      parseNativeSlackEvent({
        payload: JSON.stringify({
          type: "block_actions",
          team: { id: "T1" },
          user: { id: "U1" },
          trigger_id: "fresh-trigger",
          actions: [{ action_id: actionId }],
        }),
      }),
      null
    );
  }
});

test("activated GitHub verifies original bytes before forwarding and skips all local domain work", async () => {
  await withNativeEnv(async () => {
    const { POST } = await loadGithubWebhookRoute();
    let forwarded = 0;
    const raw = '{ "action": "opened", "installation": { "id": 99 } }\n';
    globalThis.fetch = async (input, init) => {
      assert.equal(String(input), NATIVE_URL);
      assert.equal(init?.body, raw);
      assert.equal(new Headers(init?.headers).get("x-github-delivery"), "D1");
      forwarded++;
      return new Response(null, { status: 200 });
    };
    const request = (signature: string) =>
      new Request("https://app.test/api/webhooks/github", {
        method: "POST",
        body: raw,
        headers: {
          "x-github-event": "issues",
          "x-github-delivery": "D1",
          "x-hub-signature-256": signature,
        },
      });
    assert.equal((await POST(request("sha256=invalid"))).status, 401);
    assert.equal(forwarded, 0);
    const signature = `sha256=${createHmac("sha256", SIGNING_SECRET).update(raw).digest("hex")}`;
    assert.equal((await POST(request(signature))).status, 200);
    assert.equal(forwarded, 1);
  });
});

test("native opt-in keeps GitHub per-repository-secret fallback on the authenticated legacy path", async () => {
  await withNativeEnv(async () => {
    delete process.env.GITHUB_WEBHOOK_SECRET;
    const { POST } = await loadGithubWebhookRoute();
    const raw = JSON.stringify({
      repository: { id: 42, full_name: "acme/web" },
    });
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      assert.ok(
        url.pathname.endsWith("/repos"),
        `unexpected native or domain request: ${url.pathname}`
      );
      return Response.json([
        { id: "repo-1", user_id: "U1", webhook_secret: SIGNING_SECRET },
      ]);
    };
    const request = (signature: string) =>
      new Request("https://app.test/api/webhooks/github", {
        method: "POST",
        body: raw,
        headers: { "x-github-event": "ping", "x-hub-signature-256": signature },
      });
    assert.equal((await POST(request("sha256=invalid"))).status, 401);
    const signature = `sha256=${createHmac("sha256", SIGNING_SECRET).update(raw).digest("hex")}`;
    assert.equal((await POST(request(signature))).status, 200);
  });
});

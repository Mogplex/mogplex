import assert from "node:assert/strict";
import test from "node:test";
import { signFlowWebhookPayload } from "../../lib/flows/webhook-secret";

const SECRET = "whsec_test_only_secret";

async function loadRoute() {
  return import("../../app/api/webhooks/flows/[id]/route");
}

function request(
  body: string,
  options?: { signature?: string; delivery?: string }
) {
  return new Request("http://localhost/api/webhooks/flows/flow-1", {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      ...(options?.delivery ? { "x-mogplex-delivery": options.delivery } : {}),
      ...(options?.signature
        ? { "x-mogplex-signature": options.signature }
        : {}),
    },
  });
}

test("signed flow webhook requires a unique delivery id", async () => {
  const { createFlowWebhookPostHandler } = await loadRoute();
  const response = await createFlowWebhookPostHandler({
    getSecret: async () => SECRET,
  })(request("{}"), { params: Promise.resolve({ id: "flow-1" }) });

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /x-mogplex-delivery/i);
});

test("signed flow webhook rejects an invalid HMAC", async () => {
  const { createFlowWebhookPostHandler } = await loadRoute();
  const response = await createFlowWebhookPostHandler({
    getSecret: async () => SECRET,
  })(
    request("{}", {
      delivery: "delivery-1",
      signature: "sha256=invalid",
    }),
    { params: Promise.resolve({ id: "flow-1" }) }
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Invalid signature" });
});

test("signed flow webhook dispatches verified JSON with delivery idempotency", async () => {
  const { createFlowWebhookPostHandler } = await loadRoute();
  const body = JSON.stringify({ release: { version: "1.2.3" } });
  const calls: unknown[] = [];
  const response = await createFlowWebhookPostHandler({
    getSecret: async () => SECRET,
    dispatch: async (input) => {
      calls.push(input);
      return {
        matched: true,
        outcome: "queued",
        jobRunId: "run-1",
        started: true,
        reason: null,
      };
    },
  })(
    request(body, {
      delivery: "delivery-42",
      signature: signFlowWebhookPayload(body, SECRET),
    }),
    { params: Promise.resolve({ id: "flow-1" }) }
  );

  assert.equal(response.status, 202);
  assert.deepEqual(calls, [
    {
      flowId: "flow-1",
      event: "webhook",
      idempotencyKey: "flow-webhook:flow-1:delivery-42",
      payload: { release: { version: "1.2.3" } },
      startSource: "webhook",
    },
  ]);
});

test("signed flow webhook rejects non-object JSON", async () => {
  const { createFlowWebhookPostHandler } = await loadRoute();
  const body = JSON.stringify(["not", "an", "object"]);
  const response = await createFlowWebhookPostHandler({
    getSecret: async () => SECRET,
  })(
    request(body, {
      delivery: "delivery-array",
      signature: signFlowWebhookPayload(body, SECRET),
    }),
    { params: Promise.resolve({ id: "flow-1" }) }
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "Payload must be a JSON object",
  });
});

test("signed flow webhook rejects an oversized declared body before reading it", async () => {
  const { createFlowWebhookPostHandler, FLOW_WEBHOOK_MAX_BODY_BYTES } =
    await loadRoute();
  let bodyAccessed = false;
  const oversizedRequest = {
    headers: new Headers({
      "content-length": String(FLOW_WEBHOOK_MAX_BODY_BYTES + 1),
      "x-mogplex-delivery": "delivery-oversized-declared",
    }),
    get body() {
      bodyAccessed = true;
      throw new Error("body should not be accessed");
    },
  } as unknown as Request;

  const response = await createFlowWebhookPostHandler({
    getSecret: async () => SECRET,
  })(oversizedRequest, { params: Promise.resolve({ id: "flow-1" }) });

  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: "Payload too large" });
  assert.equal(bodyAccessed, false);
});

test("signed flow webhook stops reading a chunked body at the byte limit", async () => {
  const { createFlowWebhookPostHandler, FLOW_WEBHOOK_MAX_BODY_BYTES } =
    await loadRoute();
  const chunk = new Uint8Array(Math.ceil(FLOW_WEBHOOK_MAX_BODY_BYTES / 2));
  let pulls = 0;
  let canceled = false;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        pulls += 1;
        if (pulls <= 4) {
          controller.enqueue(chunk);
        } else {
          controller.close();
        }
      },
      cancel() {
        canceled = true;
      },
    },
    { highWaterMark: 0 }
  );
  const chunkedRequest = new Request(
    "http://localhost/api/webhooks/flows/flow-1",
    {
      method: "POST",
      body,
      duplex: "half",
      headers: {
        "x-mogplex-delivery": "delivery-oversized-chunked",
      },
    } as RequestInit & { duplex: "half" }
  );

  const response = await createFlowWebhookPostHandler({
    getSecret: async () => SECRET,
  })(chunkedRequest, { params: Promise.resolve({ id: "flow-1" }) });

  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: "Payload too large" });
  assert.equal(pulls, 3);
  assert.equal(canceled, true);
});

import assert from "node:assert/strict";
import test from "node:test";
import type { Flow } from "../../lib/types";

async function loadRoute() {
  return import("../../app/api/flows/[id]/webhook-secret/route");
}

const flow = {
  id: "flow-1",
  user_id: "user-1",
} as Flow;

test("webhook secret rotation is owner-scoped and only returns the new secret", async () => {
  const { createFlowWebhookSecretPostHandler } = await loadRoute();
  const stores: unknown[] = [];
  const response = await createFlowWebhookSecretPostHandler({
    requireUserId: async () => "user-1",
    loadOwnedFlow: async () => flow,
    generateSecret: () => "whsec_generated",
    storeSecret: async (input) => {
      stores.push(input);
    },
  })(new Request("http://localhost/api/flows/flow-1/webhook-secret"), {
    params: Promise.resolve({ id: "flow-1" }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { secret: "whsec_generated" });
  assert.deepEqual(stores, [
    {
      flowId: "flow-1",
      userId: "user-1",
      secret: "whsec_generated",
    },
  ]);
});

test("webhook secret rotation hides whether another user's flow exists", async () => {
  const { createFlowWebhookSecretPostHandler } = await loadRoute();
  let stored = false;
  const response = await createFlowWebhookSecretPostHandler({
    requireUserId: async () => "user-2",
    loadOwnedFlow: async () => null,
    storeSecret: async () => {
      stored = true;
    },
  })(new Request("http://localhost/api/flows/flow-1/webhook-secret"), {
    params: Promise.resolve({ id: "flow-1" }),
  });

  assert.equal(response.status, 404);
  assert.equal(stored, false);
});

test("webhook secret rotation logs storage failures without exposing backend details", async () => {
  const { createFlowWebhookSecretPostHandler } = await loadRoute();
  const reported: unknown[] = [];
  const storageError = new Error(
    "vault flow_webhook_signing_secrets lookup failed"
  );
  const response = await createFlowWebhookSecretPostHandler({
    requireUserId: async () => "user-1",
    loadOwnedFlow: async () => flow,
    storeSecret: async () => {
      throw storageError;
    },
    reportError: (error) => {
      reported.push(error);
    },
  })(new Request("http://localhost/api/flows/flow-1/webhook-secret"), {
    params: Promise.resolve({ id: "flow-1" }),
  });

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: "Failed to generate webhook secret",
  });
  assert.deepEqual(reported, [storageError]);
});

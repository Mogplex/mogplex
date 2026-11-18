import assert from "node:assert/strict";
import test from "node:test";
import { createObservabilityGatewayClient } from "../../lib/observability/gateway-client";
import {
  createReconcileSupabase,
  createRow,
  loadReconcileModule,
} from "./helpers/reconcile-ai-call-costs-fixtures";

type ErrorResponseFixture = {
  status: number;
  body: { error: string | { message: string; type: string } };
  name: string;
};
const responses: ErrorResponseFixture[] = [401, 429, 502].map((status) => ({
  status,
  body: { error: "upstream details must not be copied into diagnostics" },
  name: "GatewayResponseError",
}));
responses.push({
  status: 429,
  body: { error: { message: "upstream details", type: "rate_limit_exceeded" } },
  name: "GatewayRateLimitError",
});

for (const { status, body, name } of responses) {
  test(`records the failed generation and HTTP ${status} from ${name} without copying the upstream body`, async () => {
    const { runAiCallCostReconciliation } = await loadReconcileModule();
    const row = createRow({
      gateway_generation_id: "gen_pending",
      gateway_generation_ids: ["gen_pending", "gen_failed"],
    });
    const { client, updates } = createReconcileSupabase([row]);
    const gateway = createObservabilityGatewayClient({
      apiKey: "test-key",
      fetch: async (input) => {
        const id = new URL(
          input instanceof Request ? input.url : String(input)
        ).searchParams.get("id");
        return Response.json(body, {
          status: id === "gen_pending" ? 404 : status,
        });
      },
    });
    const captured: Array<{ error: unknown; context: unknown }> = [];
    let metered = false;
    const summary = await runAiCallCostReconciliation({
      supabase: client as never,
      gateway,
      now: () => new Date("2026-05-16T11:00:00.000Z"),
      sentry: {
        captureException: (error, context) => {
          captured.push({ error, context });
        },
        captureMessage: () => undefined,
      },
      meterReconciledTokenUsage: async () => {
        metered = true;
        throw new Error("Incomplete costs must not be billed");
      },
    });
    assert.deepEqual(summary, {
      scanned: 1,
      reconciled: 0,
      skipped: 0,
      errored: 1,
    });
    assert.equal(metered, false);
    assert.deepEqual(updates, []);
    assert.equal(captured.length, 1);
    assert.ok(captured[0].error instanceof Error);
    assert.equal(captured[0].error.name, name);
    assert.deepEqual(captured[0].context, {
      extra: {
        ai_call_id: row.id,
        gateway_generation_id: row.gateway_generation_id,
        gateway_generation_ids: row.gateway_generation_ids,
        completed_at: row.completed_at,
        gateway_lookup: {
          generation_id: "gen_failed",
          http_status_code: status,
          sdk_status_code: status,
          retryable: status !== 401,
        },
      },
    });
    assert.ok(
      !JSON.stringify(captured[0].context).includes("upstream details")
    );
  });
}

test("the SDK's malformed 404 response stays pending without an error alert or a debit", async () => {
  const { runAiCallCostReconciliation } = await loadReconcileModule();
  const { client, updates } = createReconcileSupabase([createRow()]);
  const gateway = createObservabilityGatewayClient({
    apiKey: "test-key",
    fetch: async () =>
      Response.json({ error: "Usage event not found" }, { status: 404 }),
  });
  const captured: unknown[] = [];
  const summary = await runAiCallCostReconciliation({
    supabase: client as never,
    gateway,
    now: () => new Date("2026-05-16T11:00:00.000Z"),
    sentry: {
      captureException: (error) => {
        captured.push(error);
      },
      captureMessage: () => undefined,
    },
    meterReconciledTokenUsage: async () => {
      throw new Error("Missing costs must not be billed");
    },
  });
  assert.deepEqual(summary, {
    scanned: 1,
    reconciled: 0,
    skipped: 1,
    errored: 0,
  });
  assert.deepEqual(captured, []);
  assert.deepEqual(updates, []);
});

for (const failure of [new Error("connection reset"), "connection reset"]) {
  test(`retains an unclassified ${typeof failure} failure without inventing a status`, async () => {
    const { runAiCallCostReconciliation } = await loadReconcileModule();
    const { client, updates } = createReconcileSupabase([createRow()]);
    const captured: Array<{ error: unknown; context: unknown }> = [];
    const summary = await runAiCallCostReconciliation({
      supabase: client as never,
      gateway: {
        getGenerationInfo: async () => {
          // eslint-disable-next-line @typescript-eslint/only-throw-error -- External clients may reject with non-Error values.
          throw failure;
        },
      },
      now: () => new Date("2026-05-16T11:00:00.000Z"),
      sentry: {
        captureException: (error, context) => {
          captured.push({ error, context });
        },
        captureMessage: () => undefined,
      },
    });
    assert.equal(summary.errored, 1);
    assert.deepEqual(updates, []);
    assert.equal(captured[0].error, failure);
    assert.deepEqual(
      (captured[0].context as { extra: { gateway_lookup: unknown } }).extra
        .gateway_lookup,
      {
        generation_id: "gen_x",
        http_status_code: null,
        sdk_status_code: null,
        retryable: null,
      }
    );
  });
}

test("a real SDK transport failure does not claim an HTTP 500 response", async () => {
  const { runAiCallCostReconciliation } = await loadReconcileModule();
  const { client, updates } = createReconcileSupabase([createRow()]);
  const gateway = createObservabilityGatewayClient({
    apiKey: "test-key",
    fetch: async () => {
      throw new TypeError("fetch failed");
    },
  });
  const captured: Array<{ error: unknown; context: unknown }> = [];
  const summary = await runAiCallCostReconciliation({
    supabase: client as never,
    gateway,
    now: () => new Date("2026-05-16T11:00:00.000Z"),
    sentry: {
      captureException: (error, context) => {
        captured.push({ error, context });
      },
      captureMessage: () => undefined,
    },
  });
  assert.equal(summary.errored, 1);
  assert.deepEqual(updates, []);
  assert.ok(captured[0].error instanceof Error);
  assert.equal(captured[0].error.name, "GatewayResponseError");
  assert.deepEqual(
    (captured[0].context as { extra: { gateway_lookup: unknown } }).extra
      .gateway_lookup,
    {
      generation_id: "gen_x",
      http_status_code: null,
      sdk_status_code: 500,
      retryable: true,
    }
  );
});

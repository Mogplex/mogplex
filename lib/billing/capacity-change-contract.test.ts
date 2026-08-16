import assert from "node:assert/strict";
import { test } from "vitest";
import {
  capacityChangeIdempotencyKey,
  signCapacityChangePreview,
  validateCapacityChangeConfirmationRequest,
  validateCapacityChangePreviewRequest,
  verifyCapacityChangePreview,
  type CapacityChangePreviewTokenPayload,
} from "./capacity-change-contract";

const payload: CapacityChangePreviewTokenPayload = {
  version: 1,
  accountId: "account-1",
  subscriptionId: "sub-1",
  subscriptionItemId: null,
  lookupKey: "capacity_v2_concurrency_10_monthly",
  currentQuantity: 0,
  targetQuantity: 1,
  action: "increase",
  prorationDate: 1_787_078_400,
  effectiveAt: 1_787_078_400,
  expiresAt: 1_787_079_000,
};

test("capacity preview requests accept only canonical add-ons and quantities", () => {
  assert.deepEqual(
    validateCapacityChangePreviewRequest({
      lookupKey: "capacity_v2_concurrency_10_monthly",
      quantity: 2,
      effectiveAction: "increase",
    }),
    {
      ok: true,
      value: {
        lookupKey: "capacity_v2_concurrency_10_monthly",
        quantity: 2,
        effectiveAction: "increase",
      },
    }
  );
  for (const body of [
    null,
    {
      lookupKey: "capacity_v2_unknown",
      quantity: 1,
      effectiveAction: "increase",
    },
    {
      lookupKey: "capacity_v2_concurrency_10_monthly",
      quantity: -1,
      effectiveAction: "cancel",
    },
    {
      lookupKey: "capacity_v2_concurrency_10_monthly",
      quantity: 1.5,
      effectiveAction: "increase",
    },
    {
      lookupKey: "capacity_v2_concurrency_10_monthly",
      quantity: 1,
      effectiveAction: "replace",
    },
  ]) {
    assert.equal(validateCapacityChangePreviewRequest(body).ok, false);
  }
});

test("capacity confirmation requires a preview token and UUID attempt", () => {
  assert.equal(
    validateCapacityChangeConfirmationRequest({
      previewToken: "token",
      attemptId: "0198f3e8-9c41-4d40-8cb9-4afdfac76f01",
    }).ok,
    true
  );
  assert.equal(
    validateCapacityChangeConfirmationRequest({
      previewToken: "token",
      attemptId: "retry-me",
    }).ok,
    false
  );
  assert.equal(
    validateCapacityChangeConfirmationRequest({
      previewToken: "",
      attemptId: "0198f3e8-9c41-4d40-8cb9-4afdfac76f01",
    }).ok,
    false
  );
});

test("capacity preview tokens are signed, scoped, and expire", () => {
  const token = signCapacityChangePreview(payload, "test-secret");
  assert.deepEqual(
    verifyCapacityChangePreview({
      token,
      secret: "test-secret",
      nowSeconds: payload.prorationDate,
    }),
    payload
  );
  assert.throws(
    () =>
      verifyCapacityChangePreview({
        token: `${token.slice(0, -1)}x`,
        secret: "test-secret",
        nowSeconds: payload.prorationDate,
      }),
    /Invalid capacity preview/
  );
  assert.throws(
    () =>
      verifyCapacityChangePreview({
        token,
        secret: "wrong-secret",
        nowSeconds: payload.prorationDate,
      }),
    /Invalid capacity preview/
  );
  assert.throws(
    () =>
      verifyCapacityChangePreview({
        token,
        secret: "test-secret",
        nowSeconds: payload.expiresAt,
      }),
    /expired/
  );
});

test("capacity mutation idempotency is scoped to account and attempt", () => {
  assert.equal(
    capacityChangeIdempotencyKey(
      "account-1",
      "0198f3e8-9c41-4d40-8cb9-4afdfac76f01"
    ),
    "capacity-change:account-1:0198f3e8-9c41-4d40-8cb9-4afdfac76f01"
  );
  assert.throws(
    () => capacityChangeIdempotencyKey("account-1", "not-a-uuid"),
    /Invalid capacity change idempotency scope/
  );
});

test("capacity preview tokens reject malformed signed payloads", () => {
  const malformedPayloads = [
    { ...payload, subscriptionItemId: 42 },
    { ...payload, lookupKey: "capacity_v2_unknown" },
    { ...payload, action: "cancel" },
  ];
  for (const malformed of malformedPayloads) {
    const token = signCapacityChangePreview(
      malformed as unknown as CapacityChangePreviewTokenPayload,
      "test-secret"
    );
    assert.throws(
      () =>
        verifyCapacityChangePreview({
          token,
          secret: "test-secret",
          nowSeconds: payload.prorationDate,
        }),
      /Invalid capacity preview/
    );
  }
  assert.throws(
    () => signCapacityChangePreview(payload, ""),
    /signing secret is missing/
  );
  assert.throws(
    () =>
      verifyCapacityChangePreview({
        token: signCapacityChangePreview(payload, "test-secret"),
        secret: "",
        nowSeconds: payload.prorationDate,
      }),
    /signing secret is missing/
  );
});

import assert from "node:assert/strict";
import test from "node:test";

async function loadCheckoutRoute() {
  return import("../../lib/billing/checkout");
}

const ATTEMPT_ID = "0198f3e8-9c41-4d40-8cb9-4afdfac76f01";

test("subscribe should accept every catalog plan and reject unknown plans", async () => {
  const route = await loadCheckoutRoute();
  for (const plan of [
    "pro_monthly",
    "pro_annual",
    "team_monthly",
    "team_annual",
  ]) {
    assert.equal(
      route.validateCheckoutRequest({ kind: "subscribe", plan }).ok,
      true
    );
  }
  assert.equal(
    route.validateCheckoutRequest({ kind: "subscribe", plan: "enterprise" }).ok,
    false
  );
  assert.equal(route.validateCheckoutRequest({ kind: "subscribe" }).ok, false);
});

test("topup should reject custom amounts below the $10 minimum", async () => {
  const route = await loadCheckoutRoute();
  const result = route.validateCheckoutRequest({
    kind: "topup",
    amountCents: 999,
    attemptId: ATTEMPT_ID,
  });
  assert.equal(result.ok, false);
  assert.match((result as { error: string }).error, /Minimum top-up/);
});

test("topup should reject custom amounts above the fraud sanity cap", async () => {
  const route = await loadCheckoutRoute();
  const result = route.validateCheckoutRequest({
    kind: "topup",
    amountCents: 500001,
    attemptId: ATTEMPT_ID,
  });
  assert.equal(result.ok, false);
});

test("topup should reject non-integer and non-numeric amounts", async () => {
  const route = await loadCheckoutRoute();
  assert.equal(
    route.validateCheckoutRequest({
      kind: "topup",
      amountCents: 10.5,
      attemptId: ATTEMPT_ID,
    }).ok,
    false
  );
  assert.equal(
    route.validateCheckoutRequest({
      kind: "topup",
      amountCents: "1000",
      attemptId: ATTEMPT_ID,
    }).ok,
    false
  );
});

test("topup should accept presets and valid custom amounts", async () => {
  const route = await loadCheckoutRoute();
  assert.equal(
    route.validateCheckoutRequest({
      kind: "topup",
      preset: "topup_25",
      attemptId: ATTEMPT_ID,
    }).ok,
    true
  );
  assert.equal(
    route.validateCheckoutRequest({
      kind: "topup",
      amountCents: 1000,
      attemptId: ATTEMPT_ID,
    }).ok,
    true
  );
  assert.equal(
    route.validateCheckoutRequest({
      kind: "topup",
      amountCents: 500000,
      attemptId: ATTEMPT_ID,
    }).ok,
    true
  );
  assert.equal(
    route.validateCheckoutRequest({
      kind: "topup",
      preset: "topup_5",
      attemptId: ATTEMPT_ID,
    }).ok,
    false
  );
});

test("unknown checkout kinds and malformed bodies should be rejected", async () => {
  const route = await loadCheckoutRoute();
  assert.equal(route.validateCheckoutRequest(null).ok, false);
  assert.equal(route.validateCheckoutRequest("subscribe").ok, false);
  assert.equal(route.validateCheckoutRequest({ kind: "gift-card" }).ok, false);
});

test("topups require a client checkout-attempt id", async () => {
  const route = await loadCheckoutRoute();
  assert.equal(
    route.validateCheckoutRequest({ kind: "topup", preset: "topup_25" }).ok,
    false
  );
  assert.equal(
    route.validateCheckoutRequest({
      kind: "topup",
      preset: "topup_25",
      attemptId: "not-a-uuid",
    }).ok,
    false
  );
});

test("returnPath should only accept same-app absolute paths", async () => {
  const route = await loadCheckoutRoute();
  assert.equal(
    route.sanitizeReturnPath("/acme/settings/billing"),
    "/acme/settings/billing"
  );
  assert.equal(route.sanitizeReturnPath("https://evil.example"), "/");
  assert.equal(route.sanitizeReturnPath("//evil.example"), "/");
  assert.equal(route.sanitizeReturnPath("/path?query=1"), "/");
  assert.equal(route.sanitizeReturnPath("relative/path"), "/");
  assert.equal(route.sanitizeReturnPath(42), "/");
  assert.equal(route.sanitizeReturnPath(undefined), "/");
});

test("validated requests should carry the sanitized returnPath", async () => {
  const route = await loadCheckoutRoute();
  const valid = route.validateCheckoutRequest({
    kind: "subscribe",
    plan: "pro_monthly",
    returnPath: "/acme/settings/billing",
  });
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.request.returnPath, "/acme/settings/billing");
  }
  const fallback = route.validateCheckoutRequest({
    kind: "topup",
    preset: "topup_10",
    attemptId: ATTEMPT_ID,
    returnPath: "https://evil.example",
  });
  assert.equal(fallback.ok, true);
  if (fallback.ok) {
    assert.equal(fallback.request.returnPath, "/");
  }
});

import { expect, test } from "vitest";
import { deliverySnapshot } from "./fixtures.test-support";
import {
  deliveryNeedsRepair,
  deliveryReadyForReview,
  pinnedDeliveryPullRequest,
} from "./types";

test("PR association accepts only a positive integer from persisted metadata", () => {
  expect(pinnedDeliveryPullRequest({ delivery_pull_request_number: 42 })).toBe(
    42
  );
  for (const value of [undefined, null, "42", 0, -1, 1.5, Number.NaN]) {
    expect(
      pinnedDeliveryPullRequest({ delivery_pull_request_number: value })
    ).toBeUndefined();
  }
});

test("legacy review receipts retain repair behavior but explicit trust decisions take priority", () => {
  const snapshot = deliverySnapshot();
  snapshot.checks.state = "success";
  snapshot.review.state = "changes_requested";
  expect(deliveryNeedsRepair(snapshot)).toBe(true);
  snapshot.review.state = "none";
  snapshot.review.unresolved = 1;
  expect(deliveryNeedsRepair(snapshot)).toBe(true);
  snapshot.review.actionable = false;
  expect(deliveryNeedsRepair(snapshot)).toBe(false);
  snapshot.pullRequest = null;
  expect(deliveryNeedsRepair(snapshot)).toBe(false);
  expect(deliveryReadyForReview(snapshot)).toBe(false);
});

test("review readiness requires an open PR, successful checks, and no unresolved feedback", () => {
  const snapshot = deliverySnapshot();
  snapshot.checks.state = "success";
  snapshot.review.state = "approved";
  expect(deliveryReadyForReview(snapshot)).toBe(true);
  for (const state of ["closed", "merged"] as const) {
    snapshot.pullRequest!.state = state;
    expect(deliveryReadyForReview(snapshot)).toBe(false);
  }
  snapshot.pullRequest!.state = "open";
  for (const state of ["failure", "pending", "unknown"] as const) {
    snapshot.checks.state = state;
    expect(deliveryReadyForReview(snapshot)).toBe(false);
  }
  snapshot.checks.state = "success";
  snapshot.review.unresolved = 1;
  expect(deliveryReadyForReview(snapshot)).toBe(false);
});

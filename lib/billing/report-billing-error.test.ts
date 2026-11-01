import * as Sentry from "@sentry/nextjs";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { installInMemorySentry } from "../../tests/support/sentry-capture";
import { reportBillingError } from "./report-billing-error";
import { CapacityBillingDisabledError } from "./capacity-billing-errors";

let capture: ReturnType<typeof installInMemorySentry>;
beforeAll(() => {
  capture = installInMemorySentry();
});
beforeEach(() => {
  capture.events.length = 0;
});
afterAll(async () => {
  await Sentry.close();
});

it("reports a caught billing failure with its surface and context", async () => {
  await reportBillingError("plan_checkout", new Error("tax code is missing"), {
    accountId: "account-1",
  });
  expect(capture.events).toHaveLength(1);
  const [event] = capture.events;
  expect(event?.tags).toMatchObject({ billing_surface: "plan_checkout" });
  expect(event?.extra).toMatchObject({ accountId: "account-1" });
  expect(event?.exception?.values?.[0]?.value).toBe("tax code is missing");
});

it("does not report a closed gate the Stripe webhook keeps for replay", async () => {
  await reportBillingError(
    "stripe_webhook",
    new CapacityBillingDisabledError(),
    {
      eventId: "evt_1",
    }
  );
  expect(capture.events).toHaveLength(0);
});

it("reports a closed gate on any surface other than the Stripe webhook", async () => {
  await reportBillingError(
    "hosted_usage_checkout",
    new CapacityBillingDisabledError()
  );
  expect(capture.events).toHaveLength(1);
});

it("never lets a telemetry failure escape the failure path", async () => {
  capture.failFlush = true;
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await expect(
      reportBillingError("plan_checkout", new Error("boom"))
    ).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(
      "[billing] Could not deliver error report",
      {
        error: "transport flush unavailable",
      }
    );
  } finally {
    capture.failFlush = false;
    log.mockRestore();
  }
});

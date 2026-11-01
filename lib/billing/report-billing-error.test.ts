import * as Sentry from "@sentry/nextjs";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { installInMemorySentry } from "../../tests/support/sentry-capture";
import { reportBillingError } from "./report-billing-error";
import { CapacityBillingDisabledError } from "./capacity-billing-errors";

let capture: { events: Sentry.Event[] };
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
  reportBillingError("plan_checkout", new Error("tax code is missing"), {
    accountId: "account-1",
  });
  await Sentry.flush();
  expect(capture.events).toHaveLength(1);
  const [event] = capture.events;
  expect(event?.tags).toMatchObject({ billing_surface: "plan_checkout" });
  expect(event?.extra).toMatchObject({ accountId: "account-1" });
  expect(event?.exception?.values?.[0]?.value).toBe("tax code is missing");
});

it("does not report an intentionally closed capacity operations gate", async () => {
  reportBillingError("stripe_webhook", new CapacityBillingDisabledError(), {
    eventId: "evt_1",
  });
  await Sentry.flush();
  expect(capture.events).toHaveLength(0);
});

import * as Sentry from "@sentry/nextjs";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { reportBillingError } from "./report-billing-error";

let events: Sentry.Event[];
beforeEach(() => {
  events = [];
});
beforeAll(() => {
  Sentry.init({
    dsn: "https://public@sentry.test/1",
    defaultIntegrations: false,
    transport: () => ({
      send: async (
        envelope: Parameters<
          NonNullable<
            ReturnType<
              NonNullable<ReturnType<typeof Sentry.getClient>>["getTransport"]
            >
          >["send"]
        >[0]
      ) => {
        for (const [header, payload] of envelope[1]) {
          if (header.type === "event") events.push(payload as Sentry.Event);
        }
        return { statusCode: 200 };
      },
      flush: async () => true,
    }),
  });
});
afterAll(async () => {
  await Sentry.close();
});

it("reports a caught billing failure with its surface and context", async () => {
  reportBillingError("plan_checkout", new Error("tax code is missing"), {
    accountId: "account-1",
  });
  await Sentry.flush();
  expect(events).toHaveLength(1);
  expect(events[0]?.tags).toMatchObject({ billing_surface: "plan_checkout" });
  expect(events[0]?.extra).toMatchObject({ accountId: "account-1" });
  expect(events[0]?.exception?.values?.[0]?.value).toBe("tax code is missing");
});

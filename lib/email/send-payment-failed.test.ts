import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatInvoiceAmount,
  sendPaymentFailedEmail,
  type PaymentFailedEmailParams,
} from "./send-payment-failed";

const params: PaymentFailedEmailParams = {
  email: "billing@example.com",
  amountCents: 2000,
  currency: "usd",
  nextAttemptAt: new Date("2026-08-07T00:00:00.000Z"),
  payUrl: "https://invoice.stripe.com/i/in_2",
  idempotencyKey: "invoice-payment-failed/evt_1",
};

type ResendRequest = {
  headers: Record<string, string>;
  body: { to: string[]; subject: string; html: string; text: string };
};

function stubResend(response: Response) {
  const requests: ResendRequest[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    requests.push({
      headers: init.headers as Record<string, string>,
      body: JSON.parse(String(init.body)),
    });
    return response;
  });
  return requests;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("formatInvoiceAmount", () => {
  it("should format minor units with the currency symbol", () => {
    expect(formatInvoiceAmount(2000, "usd")).toBe("$20.00");
    expect(formatInvoiceAmount(1050, "eur")).toBe("€10.50");
  });
});

describe("sendPaymentFailedEmail", () => {
  it("should send the notice with the pay link, retry date, and idempotency key", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    const requests = stubResend(new Response("{}", { status: 200 }));

    const result = await sendPaymentFailedEmail(params);

    expect(result).toEqual({ ok: true, channel: "resend" });
    const [request] = requests;
    expect(request.headers["idempotency-key"]).toBe(
      "invoice-payment-failed/evt_1"
    );
    expect(request.body.to).toEqual(["billing@example.com"]);
    expect(request.body.subject).toBe(
      "Action needed: your Mogplex payment of $20.00 failed"
    );
    expect(request.body.text).toContain("https://invoice.stripe.com/i/in_2");
    expect(request.body.text).toContain(
      "We will try the charge again on August 7, 2026."
    );
  });

  it("should say no retry is scheduled when there is no next attempt", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    const requests = stubResend(new Response("{}", { status: 200 }));

    await sendPaymentFailedEmail({ ...params, nextAttemptAt: null });

    expect(requests[0].body.text).toContain(
      "We will not try this charge again automatically."
    );
  });

  it("should report a Resend error", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    stubResend(new Response("bad", { status: 422 }));
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await sendPaymentFailedEmail(params)).toEqual({
      ok: false,
      reason: "resend_error",
    });
  });

  it("should fail closed in production without a Resend key", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await sendPaymentFailedEmail(params)).toEqual({
      ok: false,
      reason: "not_configured",
    });
  });

  it("should log instead of sending outside production without a Resend key", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("NODE_ENV", "development");
    vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(await sendPaymentFailedEmail(params)).toEqual({
      ok: true,
      channel: "log",
    });
  });
});

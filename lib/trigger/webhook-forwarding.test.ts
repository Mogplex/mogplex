import { afterEach, describe, expect, it, vi } from "vitest";
import { forwardNativeWebhook } from "./webhook-forwarding";

const env = {
  TRIGGER_SLACK_WEBHOOK_URL: "https://api.trigger.dev/webhooks/test",
};
const headers = new Headers({
  "content-type": "application/json",
  "x-slack-request-timestamp": "123",
  "x-slack-signature": "test-signature",
  authorization: "must-not-forward",
});

afterEach(() => vi.restoreAllMocks());

describe("durable webhook forwarding", () => {
  it("logs only a safe provider correlation identifier when receipt fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const deliveryId = "a0123456-7890-1234-5678-90abcdef1234";
    const send = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("private provider diagnostics"));
    const input = new Headers({
      "x-github-delivery": deliveryId,
      "x-hub-signature-256": "private-signature",
    });
    await forwardNativeWebhook("github", "private body", input, {
      env: {
        TRIGGER_GITHUB_WEBHOOK_URL:
          "https://api.trigger.dev/webhooks/private-endpoint",
      },
      fetch: send,
    });
    expect(log).toHaveBeenCalledWith(
      "[native-webhook] github durable receipt failed",
      { deliveryId }
    );
    await forwardNativeWebhook(
      "slack",
      "private body",
      new Headers({ "x-slack-request-timestamp": "1793458500" }),
      { env, fetch: send }
    );
    expect(log).toHaveBeenLastCalledWith(
      "[native-webhook] slack durable receipt failed",
      { requestTimestamp: "1793458500" }
    );
    await forwardNativeWebhook(
      "github",
      "private body",
      new Headers({ "x-github-delivery": "private invalid identifier" }),
      { env: {}, fetch: send }
    );
    expect(log).toHaveBeenLastCalledWith(
      "[native-webhook] github durable receipt failed",
      { deliveryId: null }
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain("private");
  });
  it("preserves signed bytes and waits for durable acceptance before ACK", async () => {
    let accept: (response: Response) => void = (response) => {
      throw new Error(`Unexpected receipt: ${response.status}`);
    };
    const received = new Promise<Response>((resolve) => {
      accept = resolve;
    });
    const send = vi.fn<typeof fetch>().mockReturnValue(received);
    let acknowledged = false;
    const raw = '{ "event_id": "E1", "text": "é" }\n';
    const pending = forwardNativeWebhook("slack", raw, headers, {
      env,
      fetch: send,
    }).then((response) => {
      acknowledged = true;
      return response;
    });
    await Promise.resolve();
    expect(acknowledged).toBe(false);
    accept(new Response(null, { status: 200 }));
    expect((await pending).status).toBe(200);
    const request = send.mock.calls[0][1];
    expect(request?.body).toBe(raw);
    expect(new Headers(request?.headers).get("x-slack-signature")).toBe(
      "test-signature"
    );
    expect(new Headers(request?.headers).has("authorization")).toBe(false);
    expect(request?.redirect).toBe("error");
    expect(request?.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([401, 429, 500])(
    "returns a retryable response when hosted ingress returns %s",
    async (status) => {
      const send = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("private diagnostics", { status }));
      const response = await forwardNativeWebhook("slack", "{}", headers, {
        env,
        fetch: send,
      });
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain("private diagnostics");
      expect(send).toHaveBeenCalledTimes(1);
    }
  );

  it("does not retry or inline-process an ambiguous forwarding failure", async () => {
    const send = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("private timeout detail"));
    const response = await forwardNativeWebhook("slack", "{}", headers, {
      env,
      fetch: send,
    });
    expect(response.status).toBe(503);
    expect(send).toHaveBeenCalledTimes(1);
    expect(await response.text()).not.toContain("private timeout");
  });

  it.each([
    "https://wrong.example/webhook",
    "https://api.trigger.dev/webhook?secret=bad",
    "invalid",
  ])(
    "fails closed for invalid destinations without sending provider data: %s",
    async (url) => {
      const send = vi.fn<typeof fetch>();
      const response = await forwardNativeWebhook(
        "slack",
        "private body",
        headers,
        {
          env: { TRIGGER_SLACK_WEBHOOK_URL: url },
          fetch: send,
        }
      );
      expect(response.status).toBe(503);
      expect(send).not.toHaveBeenCalled();
    }
  );

  it("supports a matching self-hosted Trigger origin and GitHub delivery identity", async () => {
    const send = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 200 }));
    const response = await forwardNativeWebhook(
      "github",
      "{}",
      new Headers({
        "x-github-delivery": "delivery-1",
        "x-github-event": "push",
        "x-hub-signature-256": "test-signature",
      }),
      {
        env: {
          TRIGGER_API_URL: "https://trigger.internal",
          TRIGGER_GITHUB_WEBHOOK_URL: "https://trigger.internal/webhooks/test",
        },
        fetch: send,
      }
    );
    expect(response.status).toBe(200);
    expect(
      new Headers(send.mock.calls[0][1]?.headers).get("x-github-delivery")
    ).toBe("delivery-1");
  });
});

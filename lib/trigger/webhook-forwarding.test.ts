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
  it.each([
    ["slack", "https://api.trigger.dev"],
    ["github", "https://api.trigger.dev"],
    ["slack", undefined],
    ["github", undefined],
    ["slack", ""],
    ["github", ""],
  ] as const)(
    "accepts the issued Trigger Cloud webhook host for %s with task API setting %j",
    async (provider, apiOrigin) => {
      const endpoint =
        "https://webhooks.trigger.dev/webhooks/v1/ingest/synthetic-endpoint";
      const settings: Partial<NodeJS.ProcessEnv> = {
        ...(apiOrigin === undefined ? {} : { TRIGGER_API_URL: apiOrigin }),
        [`TRIGGER_${provider.toUpperCase()}_WEBHOOK_URL`]: endpoint,
      };
      const send = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status: 200 }));
      const response = await forwardNativeWebhook(
        provider,
        "signed bytes",
        headers,
        { env: settings, fetch: send }
      );
      expect(response.status).toBe(200);
      expect(String(send.mock.calls[0][0])).toBe(endpoint);
      expect(send.mock.calls[0][1]?.body).toBe("signed bytes");
      expect(settings.TRIGGER_API_URL).toBe(apiOrigin);
    }
  );

  it("keeps self-hosted ingress pinned to its configured origin", async () => {
    const send = vi.fn<typeof fetch>();
    const response = await forwardNativeWebhook(
      "github",
      "private body",
      headers,
      {
        env: {
          TRIGGER_API_URL: "https://trigger.internal",
          TRIGGER_GITHUB_WEBHOOK_URL:
            "https://webhooks.trigger.dev/webhooks/v1/ingest/synthetic-endpoint",
        },
        fetch: send,
      }
    );
    expect(response.status).toBe(503);
    expect(send).not.toHaveBeenCalled();
  });
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
      { deliveryId, reason: "transport" }
    );
    await forwardNativeWebhook(
      "slack",
      "private body",
      new Headers({ "x-slack-request-timestamp": "1793458500" }),
      { env, fetch: send }
    );
    expect(log).toHaveBeenLastCalledWith(
      "[native-webhook] slack durable receipt failed",
      { requestTimestamp: "1793458500", reason: "transport" }
    );
    await forwardNativeWebhook(
      "github",
      "private body",
      new Headers({ "x-github-delivery": "private invalid identifier" }),
      { env: {}, fetch: send }
    );
    expect(log).toHaveBeenLastCalledWith(
      "[native-webhook] github durable receipt failed",
      { deliveryId: null, reason: "config" }
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain("private");
  });

  it.each(["TimeoutError", "AbortError"])(
    "distinguishes hosted HTTP failures from %s without leaking diagnostics",
    async (errorName) => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      await forwardNativeWebhook("slack", "private body", headers, {
        env,
        fetch: vi
          .fn<typeof fetch>()
          .mockResolvedValue(new Response("private details", { status: 401 })),
      });
      expect(log).toHaveBeenLastCalledWith(
        "[native-webhook] slack durable receipt failed",
        { requestTimestamp: null, reason: "http", status: 401 }
      );
      await forwardNativeWebhook("slack", "private body", headers, {
        env,
        fetch: vi
          .fn<typeof fetch>()
          .mockRejectedValue(new DOMException("private timeout", errorName)),
      });
      expect(log).toHaveBeenLastCalledWith(
        "[native-webhook] slack durable receipt failed",
        { requestTimestamp: null, reason: "timeout" }
      );
      expect(JSON.stringify(log.mock.calls)).not.toContain("private");
    }
  );
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
    expect(request?.method).toBe("POST");
    expect(new Headers(request?.headers).get("content-type")).toBe(
      "application/json"
    );
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
      expect(await response.clone().json()).toEqual({
        error: "Webhook temporarily unavailable",
      });
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
    "https://user:pass@api.trigger.dev/webhook",
    "https://api.trigger.dev/webhook#fragment",
    // eslint-disable-next-line sonarjs/no-clear-text-protocols -- Intentionally rejected HTTP fixture.
    "http://webhooks.trigger.dev/webhooks/v1/ingest/synthetic-endpoint",
    "https://webhooks.trigger.dev.evil.example/webhook",
    "https://evil.webhooks.trigger.dev/webhook",
    "https://user:pass@webhooks.trigger.dev/webhook",
    "https://webhooks.trigger.dev/webhook?secret=bad",
    "https://webhooks.trigger.dev/webhook#fragment",
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

  it.each([
    [
      "github",
      "x-github-delivery",
      "private-a0123456-7890-1234-5678-90abcdef1234",
    ],
    [
      "github",
      "x-github-delivery",
      "a0123456-7890-1234-5678-90abcdef1234-private",
    ],
    ["slack", "x-slack-request-timestamp", "private-1793458500"],
    ["slack", "x-slack-request-timestamp", "1793458500-private"],
  ] as const)(
    "rejects extra content in %s correlation header %s: %s",
    async (provider, header, value) => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      await forwardNativeWebhook(
        provider,
        "private body",
        new Headers({ [header]: value }),
        { env: {} }
      );
      expect(log.mock.calls[0][1]).toEqual(
        provider === "github"
          ? { deliveryId: null, reason: "config" }
          : { requestTimestamp: null, reason: "config" }
      );
    }
  );

  it.each([
    ["slack", "application/x-www-form-urlencoded", 2_000],
    ["github", null, 8_000],
  ] as const)(
    "preserves %s content type and provider ACK deadline",
    async (provider, contentType, deadline) => {
      const timeout = vi
        .spyOn(AbortSignal, "timeout")
        .mockReturnValue(new AbortController().signal);
      const send = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status: 200 }));
      await forwardNativeWebhook(
        provider,
        "signed bytes",
        new Headers(contentType ? { "content-type": contentType } : {}),
        {
          env: {
            TRIGGER_SLACK_WEBHOOK_URL: env.TRIGGER_SLACK_WEBHOOK_URL,
            TRIGGER_GITHUB_WEBHOOK_URL: env.TRIGGER_SLACK_WEBHOOK_URL,
          },
          fetch: send,
        }
      );
      expect(timeout).toHaveBeenCalledExactlyOnceWith(deadline);
      const outgoing = new Headers(send.mock.calls[0][1]?.headers);
      expect(outgoing.get("content-type")).toBe(
        contentType ?? "application/json"
      );
      expect(outgoing.has("x-github-event")).toBe(false);
      expect(outgoing.has("x-slack-signature")).toBe(false);
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

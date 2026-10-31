type Provider = "github" | "slack";

const HEADER_NAMES = {
  github: ["x-github-event", "x-github-delivery", "x-hub-signature-256"],
  slack: ["x-slack-request-timestamp", "x-slack-signature"],
} as const;

/** Forward the exact signed bytes. A timeout is ambiguous: never fall back to
 * inline processing, since Trigger may already have durably accepted the event.
 */
export async function forwardNativeWebhook(
  provider: Provider,
  rawBody: string,
  originalHeaders: Headers,
  options: {
    env?: Partial<NodeJS.ProcessEnv>;
    fetch?: typeof fetch;
  } = {}
): Promise<Response> {
  const env = options.env ?? process.env;
  try {
    const endpoint = new URL(
      env[`TRIGGER_${provider.toUpperCase()}_WEBHOOK_URL`] ?? ""
    );
    const api = new URL(env.TRIGGER_API_URL ?? "https://api.trigger.dev");
    if (
      endpoint.origin !== api.origin ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash
    ) {
      throw new Error("Invalid webhook endpoint configuration");
    }
    const headers = new Headers({
      "content-type": originalHeaders.get("content-type") ?? "application/json",
    });
    for (const name of HEADER_NAMES[provider]) {
      const value = originalHeaders.get(name);
      if (value) headers.set(name, value);
    }
    const response = await (options.fetch ?? fetch)(endpoint, {
      method: "POST",
      headers,
      body: rawBody,
      redirect: "error",
      // Leave room for the edge's response within each provider's ACK window.
      signal: AbortSignal.timeout(provider === "slack" ? 2_000 : 8_000),
    });
    if (!response.ok) throw new Error("Webhook was not accepted");
    return new Response(null, { status: 200 });
  } catch {
    // Provider bodies and endpoint URLs can contain sensitive data.
    console.error(`[native-webhook] ${provider} durable receipt failed`);
    return Response.json(
      { error: "Webhook temporarily unavailable" },
      { status: 503 }
    );
  }
}

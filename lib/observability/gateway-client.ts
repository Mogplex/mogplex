import { createGateway } from "ai";

export type ObservabilityGatewayClient = Pick<
  ReturnType<typeof createGateway>,
  "getGenerationInfo" | "getSpendReport"
>;

export function createObservabilityGatewayClient(options?: {
  apiKey?: string | null;
  fetch?: typeof fetch;
}): ObservabilityGatewayClient {
  // Treat blank explicit keys as absent so callers can intentionally fall back
  // to the platform Gateway key from the environment.
  const apiKey =
    options?.apiKey?.trim() || process.env.AI_GATEWAY_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("AI_GATEWAY_API_KEY is required for Gateway observability");
  }

  return createGateway({
    apiKey,
    fetch: options?.fetch,
  });
}

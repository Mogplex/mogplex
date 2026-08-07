export async function loadAiModelResolver() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../../lib/ai-model-resolver");
}

/**
 * Helper to save and restore AI_GATEWAY_API_KEY env var
 */
export function withGatewayApiKey(
  value: string | undefined,
  fn: () => Promise<void>
): Promise<void> {
  const original = process.env.AI_GATEWAY_API_KEY;
  return (async () => {
    try {
      if (value === undefined) {
        delete process.env.AI_GATEWAY_API_KEY;
      } else {
        process.env.AI_GATEWAY_API_KEY = value;
      }
      await fn();
    } finally {
      if (original === undefined) {
        delete process.env.AI_GATEWAY_API_KEY;
      } else {
        process.env.AI_GATEWAY_API_KEY = original;
      }
    }
  })();
}

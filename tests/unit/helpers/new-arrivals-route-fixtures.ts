export async function loadRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../../app/api/models/new-arrivals/route");
}

export const seenAt = "2026-06-01T00:00:00.000Z";

export function candidate(id: string, created_at: string | null) {
  return { id, name: id, provider: "anthropic", created_at, is_hidden: false };
}

// A single personal scope that can reach everything and restricts nothing.
// Default for tests that are not exercising team-scoping itself.
export const fullAccessScopes = [
  {
    access: {
      hasGateway: true,
      hasOpenAi: true,
      hasAnthropic: true,
      hasOpenRouter: true,
    },
    allowlist: null,
  },
];

export const allowAllScopes = async () => ({
  data: fullAccessScopes,
  error: null,
  degraded: false,
});

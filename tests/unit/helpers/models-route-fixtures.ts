/**
 * Shared fixtures for models-route tests.
 */

export async function loadModelsRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../../app/api/models/route");
}

export type CatalogFixture = {
  id: string;
  provider: string;
  name: string;
  context_length: number | null;
  pricing_input: number | null;
  pricing_output: number | null;
  capabilities: string[];
  is_available: boolean;
  is_hidden: boolean;
  created_at: string | null;
};

export function catalogRow(
  overrides: Partial<CatalogFixture> & Pick<CatalogFixture, "id">
): CatalogFixture {
  return {
    provider: "test",
    name: overrides.id,
    context_length: 200_000,
    pricing_input: 0.000001,
    pricing_output: 0.000004,
    capabilities: ["tool-use"],
    is_available: true,
    is_hidden: false,
    created_at: "2000-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// Auto-enable on => the new-model off-switch policy never withholds, so these
// tests exercise the legacy "missing preference = enabled" semantics.
export const autoEnableOn = async () => ({
  data: { auto_enable_new_models: true, models_seen_at: null },
  error: null,
});

export const allProviderAccess = async () => ({
  data: {
    hasGateway: true,
    hasOpenAi: true,
    hasAnthropic: true,
    hasOpenRouter: true,
  },
  error: null,
});

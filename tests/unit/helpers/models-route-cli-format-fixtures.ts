export async function loadModelsRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../../app/api/models/route");
}

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

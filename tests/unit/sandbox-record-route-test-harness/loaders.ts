function ensureSandboxRouteTestEnv() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
}

export async function loadSandboxRecordRouteModule() {
  ensureSandboxRouteTestEnv();
  return import("../../../app/api/sandbox/[id]/route");
}

export async function loadSandboxStopRouteModule() {
  ensureSandboxRouteTestEnv();
  return import("../../../app/api/sandbox/[id]/stop/route");
}

export async function loadSandboxRestartRouteModule() {
  ensureSandboxRouteTestEnv();
  return import("../../../app/api/sandbox/[id]/restart/route");
}

export async function loadSandboxPauseRouteModule() {
  ensureSandboxRouteTestEnv();
  return import("../../../app/api/sandbox/[id]/pause/route");
}

export async function loadSandboxResumeRouteModule() {
  ensureSandboxRouteTestEnv();
  return import("../../../app/api/sandbox/[id]/resume/route");
}

export async function loadSandboxHealthRouteModule() {
  ensureSandboxRouteTestEnv();
  return import("../../../app/api/sandbox/[id]/health/route");
}

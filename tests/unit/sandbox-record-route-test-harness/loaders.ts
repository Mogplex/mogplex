function ensureSandboxRouteTestEnv() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
}

export async function loadSandboxRecordRouteModule() {
  ensureSandboxRouteTestEnv();
  const routeModule = await import("../../../app/api/sandbox/[id]/route");
  return {
    ...routeModule,
    createSandboxDeleteHandler: (
      overrides: Parameters<
        typeof routeModule.createSandboxDeleteHandler
      >[0] = {}
    ) =>
      routeModule.createSandboxDeleteHandler({
        prepareSandboxBillingClose: async () => null,
        finalizeSandboxBillingClose: async () => ({
          finalized: false,
          metered: false,
        }),
        ...overrides,
      }),
  };
}

export async function loadSandboxStopRouteModule() {
  ensureSandboxRouteTestEnv();
  const routeModule = await import("../../../app/api/sandbox/[id]/stop/route");
  return {
    ...routeModule,
    createSandboxStopHandler: (
      overrides: Parameters<typeof routeModule.createSandboxStopHandler>[0] = {}
    ) =>
      routeModule.createSandboxStopHandler({
        prepareSandboxBillingClose: async () => null,
        finalizeSandboxBillingClose: async () => ({
          finalized: false,
          metered: false,
        }),
        ...overrides,
      }),
  };
}

export async function loadSandboxRestartRouteModule() {
  ensureSandboxRouteTestEnv();
  const routeModule =
    await import("../../../app/api/sandbox/[id]/restart/route");
  return {
    ...routeModule,
    createSandboxRestartHandler: (
      overrides: Parameters<
        typeof routeModule.createSandboxRestartHandler
      >[0] = {}
    ) =>
      routeModule.createSandboxRestartHandler({
        requireSandboxBillingSession: async () => ({
          metered: true,
          reason: "opened",
          sessionId: "billing-session-1",
        }),
        prepareSandboxBillingClose: async () => null,
        finalizeSandboxBillingClose: async () => ({
          finalized: false,
          metered: false,
        }),
        ...overrides,
      }),
  };
}

export async function loadSandboxPauseRouteModule() {
  ensureSandboxRouteTestEnv();
  const routeModule = await import("../../../app/api/sandbox/[id]/pause/route");
  return {
    ...routeModule,
    createSandboxPauseHandler: (
      overrides: Parameters<
        typeof routeModule.createSandboxPauseHandler
      >[0] = {}
    ) =>
      routeModule.createSandboxPauseHandler({
        prepareSandboxBillingClose: async () => null,
        finalizeSandboxBillingClose: async () => ({
          finalized: false,
          metered: false,
        }),
        ...overrides,
      }),
  };
}

export async function loadSandboxResumeRouteModule() {
  ensureSandboxRouteTestEnv();
  const routeModule =
    await import("../../../app/api/sandbox/[id]/resume/route");
  return {
    ...routeModule,
    createSandboxResumeHandler: (
      overrides: Parameters<
        typeof routeModule.createSandboxResumeHandler
      >[0] = {}
    ) =>
      routeModule.createSandboxResumeHandler({
        requireSandboxBillingSession: async () => ({
          metered: true,
          reason: "opened",
          sessionId: "billing-session-1",
        }),
        prepareSandboxBillingClose: async () => null,
        finalizeSandboxBillingClose: async () => ({
          finalized: false,
          metered: false,
        }),
        ...overrides,
      }),
  };
}

export async function loadSandboxHealthRouteModule() {
  ensureSandboxRouteTestEnv();
  return import("../../../app/api/sandbox/[id]/health/route");
}

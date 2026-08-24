import { loadSandboxRouteModule } from "../sandbox-service-route-test-harness";

export type SandboxPostHandlerOverrides = NonNullable<
  Parameters<
    (typeof import("../../../app/api/sandbox/route"))["createSandboxPostHandler"]
  >[0]
>;

export async function createSandboxPostTestHandler(
  overrides: SandboxPostHandlerOverrides = {}
) {
  const routeModule = await loadSandboxRouteModule();
  return routeModule.createSandboxPostHandler({
    validateVercelProjectAccess: async (input) => ({
      ok: true as const,
      data: { projectId: input.projectId },
    }),
    requireSandboxBillingSession: async () => ({
      metered: true,
      reason: "opened",
      sessionId: "billing-session-1",
    }),
    prepareSandboxBillingClose: async () => null,
    recordSandboxLifecycleEvent: async () => null,
    ...overrides,
  });
}

export { type SandboxRecord } from "@/lib/types";
export {
  buildOwnedRepoWithGithubAccess,
  buildSandboxServiceRouteAuth,
  buildSandboxCollectionRequest,
  buildSandboxServiceWorkspace,
  loadSandboxRouteModule,
} from "../sandbox-service-route-test-harness";

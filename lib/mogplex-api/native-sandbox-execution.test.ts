import { afterEach, expect, it, vi } from "vitest";
import { createNativeSandboxExecution } from "./native-sandbox-execution";
import { getDelegatedUserIdFromRequest } from "@/lib/internal-api-auth";
import { readActiveTeamIdHeader } from "@/lib/team-capabilities";
import { buildSandboxServiceRouteAuth } from "../../tests/unit/sandbox-service-route-test-harness";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it.each([null, "11111111-1111-4111-8111-111111111111"])(
  "binds execution to its owner and team %s before validating the command",
  async (teamId) => {
    vi.stubEnv("INTERNAL_API_SECRET", "fixture-secret");
    vi.stubGlobal("fetch", async () => {
      throw new Error("unexpected HTTP invocation");
    });
    const execution = createNativeSandboxExecution("user-123", teamId, {
      getSandboxServiceCredentials: async (request, options) => {
        expect(getDelegatedUserIdFromRequest(request!)).toBe("user-123");
        expect(readActiveTeamIdHeader(request!)).toBe(teamId);
        expect(options?.requireCapability).toBe("tools.bash");
        return buildSandboxServiceRouteAuth();
      },
    });
    // Caller-supplied delegation cannot replace the bound owner.
    const response = await execution.execute(
      "record-1",
      { "x-mogplex-user-id": "foreign-user" },
      { command: "" }
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "command required" });
    expect(execution.retryOnSandboxLoss).toBe(false);
  }
);

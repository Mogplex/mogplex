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

it("keeps different sandboxes independent and releases a failed queue", async () => {
  vi.stubEnv("INTERNAL_API_SECRET", "fixture-secret");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  let attempts = 0;
  const execution = createNativeSandboxExecution("owner", null, {
    getSandboxServiceCredentials: async (request) => {
      if (request!.url.includes("sandbox-one") && attempts++ === 0) {
        started();
        await gate;
        throw new Error("Connection failed");
      }
      return null;
    },
  });
  const first = execution.execute("sandbox-one", {}, { command: "first" });
  const failure = expect(first).rejects.toThrow("Connection failed");
  const second = execution.execute("sandbox-one", {}, { command: "second" });
  await entered;
  try {
    expect(
      (await execution.execute("sandbox-two", {}, { command: "independent" }))
        .status
    ).toBe(401);
    expect(attempts).toBe(1);
  } finally {
    release();
  }
  await failure;
  expect((await second).status).toBe(401);
  expect(attempts).toBe(2);
});

it("does not start queued commands after cancellation", async () => {
  vi.stubEnv("INTERNAL_API_SECRET", "fixture-secret");
  const controller = new AbortController();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  let attempts = 0;
  const execution = createNativeSandboxExecution(
    "owner",
    null,
    {
      getSandboxServiceCredentials: async () => {
        attempts++;
        started();
        await gate;
        return null;
      },
    },
    controller.signal
  );
  const first = execution.execute("sandbox-one", {}, { command: "first" });
  const second = execution.execute("sandbox-one", {}, { command: "second" });
  const cancelled = expect(second).rejects.toThrow("Cancelled");
  await entered;
  controller.abort(new Error("Cancelled"));
  release();
  await first;
  await cancelled;
  expect(attempts).toBe(1);
});

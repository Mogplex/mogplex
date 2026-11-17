import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("admits sandbox commands without count quotas while preserving owner-scoped telemetry", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://database.example.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "fixture-service-role");
  const requests: { method: string; url: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        method: init?.method ?? "GET",
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      // A quota lookup would see enough recent commands to exhaust both former
      // count windows; admission must never depend on that shared history.
      return Response.json(
        init?.method === "POST"
          ? null
          : Array.from({ length: 150 }, () => ({
              created_at: new Date().toISOString(),
            }))
      );
    }
  );
  const { enforceSandboxExecLimits } = await import("./enforcement");
  expect(
    await enforceSandboxExecLimits({
      userId: "owner",
      sandboxId: "saved-sandbox",
    })
  ).toEqual({ allowed: true });
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    method: "POST",
    url: "https://database.example.test/rest/v1/limit_events",
    body: {
      user_id: "owner",
      route_key: "sandbox_exec",
      decision: "allowed",
      sandbox_id: "saved-sandbox",
      resource_id: "saved-sandbox",
    },
  });
});

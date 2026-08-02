import assert from "node:assert/strict";
import test from "node:test";

async function loadCredentialsModule() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../lib/sandbox/get-user-credentials");
}

async function loadCapabilitiesModule() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../lib/team-capabilities");
}

test("SandboxCapabilityDeniedError carries 403 and the missing cap", async () => {
  const { SandboxCapabilityDeniedError, isSandboxCapabilityDeniedError } =
    await loadCredentialsModule();
  const err = new SandboxCapabilityDeniedError("tools.bash");
  assert.equal(err.status, 403);
  assert.equal(err.capability, "tools.bash");
  assert.match(err.message, /tools\.bash/);
  assert.ok(err instanceof Error);
  assert.equal(isSandboxCapabilityDeniedError(err), true);
});

test("isSandboxCapabilityDeniedError rejects spoofed non-403 errors", async () => {
  const { isSandboxCapabilityDeniedError } = await loadCredentialsModule();
  const err = Object.assign(new Error("spoofed"), {
    name: "SandboxCapabilityDeniedError",
    capability: "tools.bash",
    status: 500,
  });

  assert.equal(isSandboxCapabilityDeniedError(err), false);
});

test("readActiveTeamIdHeader returns null for missing, whitespace, or malformed values", async () => {
  const { readActiveTeamIdHeader, ACTIVE_TEAM_HEADER } =
    await loadCapabilitiesModule();
  const teamUuid = "00000000-0000-4000-8000-000000000001";

  assert.equal(readActiveTeamIdHeader(new Request("https://x")), null);
  assert.equal(
    readActiveTeamIdHeader(
      new Request("https://x", { headers: { [ACTIVE_TEAM_HEADER]: "   " } })
    ),
    null
  );
  // Malformed non-UUID values degrade to null so they don't reach Postgres.
  assert.equal(
    readActiveTeamIdHeader(
      new Request("https://x", { headers: { [ACTIVE_TEAM_HEADER]: "team-1" } })
    ),
    null
  );
  assert.equal(
    readActiveTeamIdHeader(
      new Request("https://x", {
        headers: { [ACTIVE_TEAM_HEADER]: teamUuid },
      })
    ),
    teamUuid
  );
});

test("POST /api/sandbox returns 403 when getSandboxServiceCredentials denies the bash capability", async () => {
  const { createSandboxPostHandler } =
    await import("../../app/api/sandbox/route");
  const { SandboxCapabilityDeniedError } = await loadCredentialsModule();

  let createCalls = 0;
  let credentialCalls = 0;
  const handler = createSandboxPostHandler({
    getSandboxServiceCredentials: async (_request, options) => {
      credentialCalls += 1;
      // Mirror the production gate: when the route asks for tools.bash and
      // the scope can't grant it, the function throws.
      if (options?.requireCapability === "tools.bash") {
        throw new SandboxCapabilityDeniedError("tools.bash");
      }
      throw new Error("test expected requireCapability=tools.bash");
    },
    createSandboxForRepo: async () => {
      createCalls += 1;
      throw new Error("createSandboxForRepo should not be called");
    },
    createSandboxFromSnapshot: async () => {
      createCalls += 1;
      throw new Error("createSandboxFromSnapshot should not be called");
    },
  });

  const response = await handler(
    new Request("http://localhost/api/sandbox", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-mogplex-team-id": "00000000-0000-4000-8000-000000000001",
      },
      body: JSON.stringify({ repoId: "repo-1" }),
    })
  );

  assert.equal(response.status, 403);
  const body = (await response.json()) as { error: string };
  assert.match(body.error, /tools\.bash/);
  assert.equal(credentialCalls, 1);
  assert.equal(createCalls, 0);
});

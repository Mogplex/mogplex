import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const oauthMigrationUrl = new URL(
  "../../supabase/migrations/20260720160000_mogplex_mcp_oauth.sql",
  import.meta.url
);
const oauthHookFixMigrationUrl = new URL(
  "../../supabase/migrations/20260728164015_guard_oauth_hook_null_claims.sql",
  import.meta.url
);

function configureEnv() {
  process.env.NEXT_PUBLIC_APP_URL = "https://mogplex.com";
  process.env.MOGPLEX_MCP_RESOURCE_URL =
    "https://mogplex.com/api/v1/mogplex/mcp";
  process.env.NEXT_PUBLIC_SUPABASE_URL =
    "https://testprojectref000000.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
}

test("Mogplex MCP protected-resource metadata points to Supabase OAuth", async () => {
  configureEnv();
  const { buildMogplexMcpProtectedResourceMetadata } =
    await import("../../lib/mogplex-api/oauth-config");

  assert.deepEqual(buildMogplexMcpProtectedResourceMetadata(), {
    resource: "https://mogplex.com/api/v1/mogplex/mcp",
    authorization_servers: ["https://testprojectref000000.supabase.co/auth/v1"],
    resource_documentation:
      "https://github.com/mogplex/mogplex/blob/main/docs/mogplex-api-mcp/local-agent-automation.md",
  });
});

test("Mogplex OAuth verifier requires audience, issuer, client approval, and a linked profile", async () => {
  configureEnv();
  const {
    __resetMogplexOAuthVerifierForTesting,
    __setMogplexOAuthVerifierDependenciesForTesting,
    resolveMogplexOAuthToken,
  } = await import("../../lib/auth/mogplex-oauth");
  const verifierCalls: unknown[] = [];

  __setMogplexOAuthVerifierDependenciesForTesting({
    verifyJwt: async (_token, _key, options) => {
      verifierCalls.push(options);
      return {
        payload: {
          sub: "auth-user-1",
          client_id: "oauth-client-1",
          exp: Math.floor(Date.now() / 1000) + 3600,
        },
        protectedHeader: { alg: "ES256" },
      } as never;
    },
    isClientAllowed: async (clientId) => clientId === "oauth-client-1",
    resolveProfileId: async (authUserId) =>
      authUserId === "auth-user-1" ? "profile-1" : null,
    getVerificationKey: () => ({}) as never,
  });

  try {
    const result = await resolveMogplexOAuthToken("Bearer oauth.jwt.token");
    assert.deepEqual(result, {
      ok: true,
      auth: {
        userId: "profile-1",
        keyId: "oauth-client-1",
        scopes: ["read", "write"],
      },
    });
    assert.deepEqual(verifierCalls, [
      {
        issuer: "https://testprojectref000000.supabase.co/auth/v1",
        audience: "https://mogplex.com/api/v1/mogplex/mcp",
      },
    ]);
  } finally {
    __resetMogplexOAuthVerifierForTesting();
  }
});

test("Mogplex OAuth verifier rejects unapproved clients", async () => {
  configureEnv();
  const {
    __resetMogplexOAuthVerifierForTesting,
    __setMogplexOAuthVerifierDependenciesForTesting,
    resolveMogplexOAuthToken,
  } = await import("../../lib/auth/mogplex-oauth");
  let profileLookups = 0;

  __setMogplexOAuthVerifierDependenciesForTesting({
    verifyJwt: async () =>
      ({
        payload: {
          sub: "auth-user-1",
          client_id: "unapproved-client",
          exp: Math.floor(Date.now() / 1000) + 3600,
        },
        protectedHeader: { alg: "ES256" },
      }) as never,
    isClientAllowed: async () => false,
    resolveProfileId: async () => {
      profileLookups += 1;
      return "profile-1";
    },
    getVerificationKey: () => ({}) as never,
  });

  try {
    assert.deepEqual(await resolveMogplexOAuthToken("Bearer oauth.jwt.token"), {
      ok: false,
      reason: "invalid",
    });
    assert.equal(profileLookups, 0);
  } finally {
    __resetMogplexOAuthVerifierForTesting();
  }
});

test("Mogplex OAuth verifier rejects tokens without an expiry", async () => {
  configureEnv();
  const {
    __resetMogplexOAuthVerifierForTesting,
    __setMogplexOAuthVerifierDependenciesForTesting,
    resolveMogplexOAuthToken,
  } = await import("../../lib/auth/mogplex-oauth");
  let allowlistLookups = 0;

  __setMogplexOAuthVerifierDependenciesForTesting({
    verifyJwt: async () =>
      ({
        payload: { sub: "auth-user-1", client_id: "oauth-client-1" },
        protectedHeader: { alg: "ES256" },
      }) as never,
    isClientAllowed: async () => {
      allowlistLookups += 1;
      return true;
    },
    getVerificationKey: () => ({}) as never,
  });

  try {
    assert.deepEqual(await resolveMogplexOAuthToken("Bearer oauth.jwt.token"), {
      ok: false,
      reason: "invalid",
    });
    assert.equal(allowlistLookups, 0);
  } finally {
    __resetMogplexOAuthVerifierForTesting();
  }
});

test("Mogplex OAuth consent helpers validate authorization ids and decisions", async () => {
  const {
    buildMogplexOAuthConsentPath,
    buildMogplexOAuthTerminalErrorPath,
    parseMogplexAuthorizationId,
    parseMogplexOAuthDecision,
  } = await import("../../lib/mogplex-api/oauth-consent");

  assert.equal(parseMogplexAuthorizationId("auth_123"), "auth_123");
  assert.equal(parseMogplexAuthorizationId("bad/id"), null);
  assert.equal(parseMogplexOAuthDecision("approve"), "approve");
  assert.equal(parseMogplexOAuthDecision("maybe"), null);
  assert.equal(
    buildMogplexOAuthConsentPath("auth_123", "consent_failed"),
    "/oauth/consent?authorization_id=auth_123&decision_error=consent_failed"
  );
  assert.equal(
    buildMogplexOAuthTerminalErrorPath("consent_failed"),
    "/oauth/consent?decision_error=consent_failed"
  );
});

test("Mogplex OAuth hook derives the token audience from the approved client", async () => {
  const sql = await readFile(oauthMigrationUrl, "utf8");

  assert.match(sql, /resource_url text not null/i);
  assert.match(
    sql,
    /select resource_url\s+into oauth_resource_url\s+from public\.mcp_oauth_clients\s+where client_id = oauth_client_id/i
  );
  assert.match(sql, /to_jsonb\(oauth_resource_url\)/i);
  assert.doesNotMatch(
    sql,
    /https:\/\/www\.mogplex\.com\/api\/v1\/mogplex\/mcp/i
  );
});

test("Mogplex OAuth hook reads the client id from the top-level event field", async () => {
  const sql = await readFile(oauthHookFixMigrationUrl, "utf8");

  // Supabase Auth delivers client_id as a top-level event field, not a claim.
  // Reading only claims left tokens with the default "authenticated" audience
  // and every OAuth MCP request failed with 401.
  assert.match(
    sql,
    /coalesce\(\s*event ->> 'client_id',\s*claims ->> 'client_id',\s*claims ->> 'azp'\s*\)/i
  );
  assert.match(sql, /to_jsonb\(oauth_resource_url\)/i);
  // jsonb_set on a NULL claims object would propagate NULL and fail token
  // issuance, so the rewrite must be gated on claims being present.
  assert.match(
    sql,
    /if oauth_resource_url is not null and claims is not null then/i
  );
  // The verifier hard-fails without a client_id claim, so the hook must
  // write it into the token rather than rely on Supabase adding it.
  assert.match(
    sql,
    /jsonb_set\(\s*claims,\s*'\{client_id\}',\s*to_jsonb\(oauth_client_id\),\s*true\s*\)/i
  );
  assert.match(
    sql,
    /grant execute on function public\.custom_access_token_hook\(jsonb\)\s+to supabase_auth_admin/i
  );
  assert.doesNotMatch(
    sql,
    /https:\/\/www\.mogplex\.com\/api\/v1\/mogplex\/mcp/i
  );
});

test("Mogplex OAuth decision rolls back a new client when consent finalization fails", async () => {
  configureEnv();
  const { createMogplexOAuthDecisionHandler } =
    await import("../../app/api/oauth/decision/route");
  const registration = {
    clientId: "oauth-client-1",
    approvedBy: "auth-user-1",
    approvedAt: "2026-07-20T21:00:00.000Z",
  };
  const approvalFailures = [
    {
      name: "returned error",
      finalize: async () => ({
        data: null,
        error: new Error("approval failed"),
      }),
    },
    {
      name: "rejected promise",
      finalize: async () => {
        throw new Error("approval unavailable");
      },
    },
  ];

  for (const approvalFailure of approvalFailures) {
    const calls: string[] = [];
    const handler = createMogplexOAuthDecisionHandler({
      createClient: async () =>
        ({
          auth: {
            getUser: async () => ({
              data: { user: { id: "auth-user-1" } },
              error: null,
            }),
            oauth: {
              getAuthorizationDetails: async () => ({
                data: {
                  authorization_id: "auth_123",
                  redirect_uri: "http://127.0.0.1:1455/callback",
                  client: {
                    id: "oauth-client-1",
                    name: "Codex",
                    uri: "https://openai.com/codex",
                    logo_uri: "",
                  },
                  user: { id: "auth-user-1", email: "user@example.com" },
                  scope: "openid email",
                },
                error: null,
              }),
              approveAuthorization: async () => {
                calls.push("approve");
                return approvalFailure.finalize();
              },
              denyAuthorization: async () => {
                throw new Error("deny should not run");
              },
            },
          },
        }) as never,
      registerClient: async (input) => {
        calls.push("register");
        assert.deepEqual(input, {
          clientId: "oauth-client-1",
          clientName: "Codex",
          approvedBy: "auth-user-1",
          resourceUrl: "https://mogplex.com/api/v1/mogplex/mcp",
        });
        return registration;
      },
      removeRegistration: async (input) => {
        calls.push("rollback");
        assert.deepEqual(input, registration);
      },
    });

    const response = await handler(
      new Request("https://mogplex.com/api/oauth/decision", {
        method: "POST",
        headers: {
          origin: "https://mogplex.com",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          authorization_id: "auth_123",
          decision: "approve",
        }),
      })
    );

    assert.equal(response.status, 303, approvalFailure.name);
    assert.equal(
      response.headers.get("location"),
      "https://mogplex.com/oauth/consent?decision_error=consent_failed",
      approvalFailure.name
    );
    assert.deepEqual(
      calls,
      ["register", "approve", "rollback"],
      approvalFailure.name
    );
  }
});

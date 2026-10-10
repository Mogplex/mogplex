import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import {
  buildCanonicalHostRedirectUrl,
  buildLoginRedirectUrl,
  config,
  createProxy,
  proxy,
} from "../../proxy";
import {
  isAutomationOnlyKeyOnDirectPath,
  isCliPatApiRequest,
  isMogplexBearerApiRequest,
} from "../../lib/internal-api-auth";

const fullAccessProxy = createProxy({ lookupApiKeyAccess: async () => "full" });
const automationsOnlyProxy = createProxy({
  lookupApiKeyAccess: async () => "automations",
});

test("proxy module exports the root proxy handler", () => {
  assert.equal(typeof proxy, "function");
});

test("proxy module preserves the root matcher", () => {
  assert.deepEqual(config.matcher, [
    String.raw`/((?!_next/static|_next/image|favicon.ico|fonts/|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)`,
  ]);
});

test("anonymous login redirects preserve the original path and query", () => {
  const request = new NextRequest(
    "https://mogplex.com/cli-auth?callback=http%3A%2F%2Flocalhost%3A45454%2Fcallback&nonce=abc123&name=CLI"
  );

  assert.equal(
    buildLoginRedirectUrl(request, false).toString(),
    "https://mogplex.com/login?next=%2Fcli-auth%3Fcallback%3Dhttp%253A%252F%252Flocalhost%253A45454%252Fcallback%26nonce%3Dabc123%26name%3DCLI"
  );
  assert.equal(
    buildLoginRedirectUrl(request, true).toString(),
    "https://mogplex.com/login?expired=true&next=%2Fcli-auth%3Fcallback%3Dhttp%253A%252F%252Flocalhost%253A45454%252Fcallback%26nonce%3Dabc123%26name%3DCLI"
  );
});

test("the legacy www host redirects to the configured canonical origin", async () => {
  await withEnv(
    { NEXT_PUBLIC_APP_URL: "https://mogplex.com", APP_URL: undefined },
    () => {
      const request = new NextRequest(
        "https://www.mogplex.com/cli-auth?nonce=abc123"
      );

      assert.equal(
        buildCanonicalHostRedirectUrl(request)?.toString(),
        "https://mogplex.com/cli-auth?nonce=abc123"
      );
    }
  );
});

test("canonical and unrelated hosts are not redirected", async () => {
  await withEnv(
    { NEXT_PUBLIC_APP_URL: "https://mogplex.com", APP_URL: undefined },
    () => {
      assert.equal(
        buildCanonicalHostRedirectUrl(
          new NextRequest("https://mogplex.com/cli-auth")
        ),
        null
      );
      assert.equal(
        buildCanonicalHostRedirectUrl(
          new NextRequest("https://preview.example/cli-auth")
        ),
        null
      );
    }
  );
});

function makeRequest(headers: Record<string, string> = {}) {
  return new Request("https://example.com/", { headers });
}

async function withEnv<T>(
  overrides: Record<string, string | undefined>,
  callback: () => Promise<T> | T
) {
  const original = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries(overrides)) {
    original.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await callback();
  } finally {
    for (const [key, value] of original.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("isCliPatApiRequest detects CLI PATs on /api/* paths", () => {
  const request = makeRequest({ authorization: "Bearer mog_abc123" });
  assert.equal(isCliPatApiRequest(request, "/api/v1/mogplex"), true);
  assert.equal(isCliPatApiRequest(request, "/api/v1/mogplex/repos"), true);
  assert.equal(isCliPatApiRequest(request, "/api/mcp-servers"), true);
  assert.equal(isCliPatApiRequest(request, "/api/models"), true);
  assert.equal(isCliPatApiRequest(request, "/api/settings"), true);
  // /api/sandbox is PAT-aware: both the collection and sub-resources (stop,
  // delete, exec, …) delegate auth to the route handler.
  assert.equal(isCliPatApiRequest(request, "/api/sandbox"), true);
  assert.equal(
    isCliPatApiRequest(request, "/api/sandbox/sandbox-1/stop"),
    true
  );
  assert.equal(
    isCliPatApiRequest(request, "/api/cli/inference/chat/completions"),
    true
  );
  assert.equal(
    isCliPatApiRequest(request, "/api/cli/openai/chat/completions"),
    true
  );
});

test("isCliPatApiRequest ignores non-PAT CLI paths", () => {
  const request = makeRequest({ authorization: "Bearer mog_abc123" });
  assert.equal(isCliPatApiRequest(request, "/api/skills/registry"), false);
  assert.equal(isCliPatApiRequest(request, "/api/cron/run"), false);
  assert.equal(isCliPatApiRequest(request, "/spaces"), false);
});

test("isCliPatApiRequest ignores non-PAT bearers and missing headers", () => {
  assert.equal(
    isCliPatApiRequest(
      makeRequest({ authorization: "Bearer sk_abc" }),
      "/api/mcp-servers"
    ),
    false
  );
  assert.equal(
    isCliPatApiRequest(
      makeRequest({ authorization: "mog_abc" }),
      "/api/mcp-servers"
    ),
    false
  );
  assert.equal(isCliPatApiRequest(makeRequest(), "/api/mcp-servers"), false);
});

test("isMogplexBearerApiRequest delegates OAuth on hosted CLI API paths", () => {
  const request = makeRequest({ authorization: "Bearer oauth.jwt.token" });
  assert.equal(isMogplexBearerApiRequest(request, "/api/v1/mogplex"), true);
  assert.equal(
    isMogplexBearerApiRequest(request, "/api/v1/mogplex/automations"),
    true
  );
  assert.equal(isMogplexBearerApiRequest(request, "/api/settings"), true);
  assert.equal(isMogplexBearerApiRequest(request, "/api/models"), true);
  assert.equal(isMogplexBearerApiRequest(request, "/api/mcp-servers"), true);
  assert.equal(
    isMogplexBearerApiRequest(request, "/api/cli/inference/chat/completions"),
    true
  );
  assert.equal(
    isMogplexBearerApiRequest(request, "/api/skills/registry"),
    false
  );
  assert.equal(isMogplexBearerApiRequest(request, "/api/v1/mogplexx"), false);
  assert.equal(
    isMogplexBearerApiRequest(makeRequest(), "/api/v1/mogplex"),
    false
  );
});

test("proxy keeps machine-auth routes hard-gated even with a CLI PAT header", async () => {
  await withEnv({ CRON_SECRET: undefined }, async () => {
    const request = new NextRequest("https://example.com/api/cron/run", {
      headers: { authorization: "Bearer mog_abc123" },
    });

    const response = await proxy(request);

    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: "CRON_SECRET_NOT_CONFIGURED",
    });
  });
});

test("proxy lets CLI PAT requests reach hosted inference routes", async () => {
  const request = new NextRequest(
    "https://example.com/api/cli/inference/chat/completions",
    {
      method: "POST",
      headers: { authorization: "Bearer mog_abc123" },
    }
  );

  const response = await fullAccessProxy(request);

  // The meaningful invariant is that the proxy called NextResponse.next() —
  // asserted via the `x-middleware-next` header it sets — and did not
  // redirect or issue an auth-failure response. Status 200 alone is brittle
  // because it conflates pass-through with any downstream 200.
  assert.equal(response.headers.get("x-middleware-next"), "1");
  assert.equal(response.headers.get("location"), null);
  assert.equal(response.headers.get("www-authenticate"), null);
});

test("proxy lets CLI OAuth requests reach hosted inference routes", async () => {
  const request = new NextRequest(
    "https://example.com/api/cli/inference/chat/completions",
    {
      method: "POST",
      headers: { authorization: "Bearer oauth.jwt.token" },
    }
  );

  const response = await proxy(request);

  assert.equal(response.headers.get("x-middleware-next"), "1");
  assert.equal(response.headers.get("location"), null);
  assert.equal(response.headers.get("www-authenticate"), null);
});

test("proxy lets unauthenticated MCP initialization reach the OAuth challenge", async () => {
  const request = new NextRequest("https://mogplex.com/api/v1/mogplex/mcp", {
    method: "POST",
  });

  const response = await proxy(request);

  assert.equal(response.headers.get("x-middleware-next"), "1");
  assert.equal(response.headers.get("location"), null);
});

test("proxy refuses an automations-only key on hosted inference with the automation error", async () => {
  const request = new NextRequest(
    "https://example.com/api/cli/inference/chat/completions",
    { method: "POST", headers: { authorization: "Bearer mog_abc123" } }
  );

  const response = await automationsOnlyProxy(request);

  assert.equal(response.status, 403);
  assert.equal(response.headers.get("x-middleware-next"), null);
  assert.equal((await response.json()).code, "AUTOMATION_REQUIRED");
});

test("proxy refuses an automations-only key on sandbox routes", async () => {
  const request = new NextRequest(
    "https://example.com/api/sandbox/sandbox-1/harness",
    { method: "POST", headers: { authorization: "Bearer mog_abc123" } }
  );

  const response = await automationsOnlyProxy(request);

  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "AUTOMATION_REQUIRED");
});

test("proxy lets a full-access key reach sandbox routes", async () => {
  const request = new NextRequest(
    "https://example.com/api/sandbox/sandbox-1/harness",
    { method: "POST", headers: { authorization: "Bearer mog_abc123" } }
  );

  const response = await fullAccessProxy(request);

  assert.equal(response.headers.get("x-middleware-next"), "1");
});

test("isAutomationOnlyKeyOnDirectPath looks up only keys on direct-execution paths", async () => {
  const lookedUp: string[] = [];
  const lookup = async (authorization: string) => {
    lookedUp.push(authorization);
    return "automations" as const;
  };
  const key = (method = "POST") =>
    new Request("https://example.com/", {
      method,
      headers: { authorization: "Bearer mog_abc123" },
    });

  assert.equal(
    await isAutomationOnlyKeyOnDirectPath(key(), "/api/sandbox", lookup),
    true
  );
  // Settings stay readable with any key; only writes are direct.
  assert.equal(
    await isAutomationOnlyKeyOnDirectPath(key("GET"), "/api/settings", lookup),
    false
  );
  assert.equal(
    await isAutomationOnlyKeyOnDirectPath(
      key("PATCH"),
      "/api/settings",
      lookup
    ),
    true
  );
  // OAuth bearers and paths outside the list never trigger a lookup.
  const oauth = new Request("https://example.com/", {
    method: "POST",
    headers: { authorization: "Bearer oauth_token" },
  });
  assert.equal(
    await isAutomationOnlyKeyOnDirectPath(oauth, "/api/sandbox", lookup),
    false
  );
  assert.equal(
    await isAutomationOnlyKeyOnDirectPath(key(), "/api/models", lookup),
    false
  );
  assert.equal(lookedUp.length, 2);
  // An unknown or revoked key is left for the route to answer 401.
  assert.equal(
    await isAutomationOnlyKeyOnDirectPath(
      key(),
      "/api/sandbox",
      async () => null
    ),
    false
  );
});

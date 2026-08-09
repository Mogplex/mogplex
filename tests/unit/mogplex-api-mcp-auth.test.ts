import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import { handleMogplexMcpPayload } from "../../lib/mogplex-api/mcp";

import {
  buildFakeMcpClient,
  loadMcpRoute,
} from "./helpers/mogplex-api-mcp-fixtures";

test("POST /api/v1/mogplex/mcp advertises OAuth when authentication is missing", async () => {
  const { createMogplexMcpPostHandler } = await loadMcpRoute();
  const handler = createMogplexMcpPostHandler({
    resolveApiKey: async () => {
      throw new Error("resolveApiKey should not run");
    },
    createClient: () => buildFakeMcpClient(),
  });

  const response = await handler(
    new NextRequest("http://localhost/api/v1/mogplex/mcp", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    })
  );

  assert.equal(response.status, 401);
  assert.equal(
    response.headers.get("www-authenticate"),
    'Bearer resource_metadata="http://localhost/.well-known/oauth-protected-resource/api/v1/mogplex/mcp"'
  );
  assert.deepEqual(await response.json(), {
    jsonrpc: "2.0",
    id: 1,
    error: {
      code: -32001,
      message: "Unauthorized",
      data: {
        code: "UNAUTHORIZED",
        suggestion: "Sign in with OAuth or configure a Mogplex API token.",
      },
    },
  });
});

test("POST /api/v1/mogplex/mcp accepts OAuth bearer tokens", async () => {
  const { createMogplexMcpPostHandler } = await loadMcpRoute();
  const handler = createMogplexMcpPostHandler({
    resolveApiKey: async () => {
      throw new Error("PAT resolver should not run for OAuth tokens");
    },
    resolveOAuthToken: async (authorization) => {
      assert.equal(authorization, "Bearer oauth.jwt.token");
      return {
        ok: true,
        auth: {
          userId: "profile-123",
          keyId: "oauth-client-1",
          scopes: ["read", "write"],
        },
      };
    },
    createClient: ({ authorization }) => {
      assert.equal(authorization, "Bearer oauth.jwt.token");
      return buildFakeMcpClient();
    },
  });

  const response = await handler(
    new NextRequest("http://localhost/api/v1/mogplex/mcp", {
      method: "POST",
      headers: { authorization: "Bearer oauth.jwt.token" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    })
  );

  assert.equal(response.status, 200);
  assert.equal((await response.json()).result.tools.length, 23);
});

test("POST /api/v1/mogplex/mcp handles authenticated tools/list", async () => {
  const { createMogplexMcpPostHandler } = await loadMcpRoute();
  const handler = createMogplexMcpPostHandler({
    resolveApiKey: async (authorization) => {
      assert.equal(authorization, "Bearer mog_valid");
      return {
        ok: true,
        auth: { userId: "user-123", keyId: "key-1", scopes: ["read"] },
      };
    },
    createClient: ({ authorization }) => {
      assert.equal(authorization, "Bearer mog_valid");
      return buildFakeMcpClient();
    },
  });

  const response = await handler(
    new NextRequest("http://localhost/api/v1/mogplex/mcp", {
      method: "POST",
      headers: {
        authorization: "Bearer mog_valid",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    })
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("mcp-protocol-version"), "2025-11-25");
  assert.equal(payload.result.tools.length, 23);
});

test("OPTIONS /api/v1/mogplex/mcp rejects origins outside the allow-list", async () => {
  const { OPTIONS } = await loadMcpRoute();
  const originalAllowedOrigins = process.env.MOGPLEX_MCP_ALLOWED_ORIGINS;
  const originalConsoleWarn = console.warn;
  const warnings: unknown[][] = [];
  process.env.MOGPLEX_MCP_ALLOWED_ORIGINS = "https://chat.example.com";
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };

  try {
    const response = OPTIONS(
      new NextRequest("https://mogplex.example/api/v1/mogplex/mcp", {
        method: "OPTIONS",
        headers: {
          origin: "https://attacker.example",
        },
      })
    );

    assert.equal(response.status, 403);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
    assert.equal(response.headers.get("access-control-allow-headers"), null);
    assert.equal(response.headers.get("access-control-allow-methods"), null);
    assert.equal(response.headers.get("access-control-max-age"), null);
    assert.equal(response.headers.get("vary"), "origin");
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0][0], "[mogplex-mcp/cors] rejected origin");
  } finally {
    console.warn = originalConsoleWarn;
    if (originalAllowedOrigins === undefined) {
      delete process.env.MOGPLEX_MCP_ALLOWED_ORIGINS;
    } else {
      process.env.MOGPLEX_MCP_ALLOWED_ORIGINS = originalAllowedOrigins;
    }
  }
});

test("OPTIONS /api/v1/mogplex/mcp logs cross-origin rejections when no allow-list is configured", async () => {
  const { OPTIONS } = await loadMcpRoute();
  const originalAllowedOrigins = process.env.MOGPLEX_MCP_ALLOWED_ORIGINS;
  const originalConsoleWarn = console.warn;
  const warnings: unknown[][] = [];
  delete process.env.MOGPLEX_MCP_ALLOWED_ORIGINS;
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };

  try {
    const response = OPTIONS(
      new NextRequest("https://mogplex.example/api/v1/mogplex/mcp", {
        method: "OPTIONS",
        headers: {
          origin: "https://chat.example.com",
        },
      })
    );

    assert.equal(response.status, 403);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
    assert.equal(response.headers.get("access-control-allow-headers"), null);
    assert.equal(response.headers.get("access-control-allow-methods"), null);
    assert.equal(response.headers.get("access-control-max-age"), null);
    assert.equal(warnings.length, 1);
    assert.deepEqual(warnings[0][1], {
      origin: "https://chat.example.com",
      requestOrigin: "https://mogplex.example",
      allowedOrigins: [],
    });
  } finally {
    console.warn = originalConsoleWarn;
    if (originalAllowedOrigins === undefined) {
      delete process.env.MOGPLEX_MCP_ALLOWED_ORIGINS;
    } else {
      process.env.MOGPLEX_MCP_ALLOWED_ORIGINS = originalAllowedOrigins;
    }
  }
});

test("Mogplex MCP batch isolates unexpected parser failures", async () => {
  const originalConsoleError = console.error;
  const errors: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    errors.push(args);
  };
  const crashingMessage = { jsonrpc: "2.0", method: "ping" };
  Object.defineProperty(crashingMessage, "id", {
    get() {
      throw new Error("id exploded");
    },
  });

  try {
    const response = await handleMogplexMcpPayload(
      [{ jsonrpc: "2.0", id: "ok", method: "tools/list" }, crashingMessage],
      { client: buildFakeMcpClient() }
    );

    assert.ok(Array.isArray(response));
    assert.equal(response.length, 2);
    assert.equal(response[0]?.jsonrpc, "2.0");
    assert.equal("result" in response[0]!, true);
    assert.deepEqual(response[1], {
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32603,
        message: "Mogplex MCP request failed",
        data: {
          code: "INTERNAL_ERROR",
        },
      },
    });
    assert.equal(errors[0]?.[0], "[mogplex-mcp] unexpected message failure");
  } finally {
    console.error = originalConsoleError;
  }
});

test("OPTIONS and POST /api/v1/mogplex/mcp reflect allowed origins", async () => {
  const { OPTIONS, createMogplexMcpPostHandler } = await loadMcpRoute();
  const originalAllowedOrigins = process.env.MOGPLEX_MCP_ALLOWED_ORIGINS;
  process.env.MOGPLEX_MCP_ALLOWED_ORIGINS = "https://chat.example.com";

  try {
    const preflight = OPTIONS(
      new NextRequest("https://mogplex.example/api/v1/mogplex/mcp", {
        method: "OPTIONS",
        headers: {
          origin: "https://chat.example.com",
        },
      })
    );
    assert.equal(preflight.status, 204);
    assert.equal(
      preflight.headers.get("access-control-allow-headers"),
      "authorization, content-type, mcp-protocol-version, mcp-session-id"
    );
    assert.equal(
      preflight.headers.get("access-control-allow-methods"),
      "POST, OPTIONS"
    );
    assert.equal(preflight.headers.get("access-control-max-age"), "86400");
    assert.equal(
      preflight.headers.get("access-control-allow-origin"),
      "https://chat.example.com"
    );

    const handler = createMogplexMcpPostHandler({
      resolveApiKey: async () => ({
        ok: true,
        auth: {
          userId: "user-123",
          keyId: "key-1",
          scopes: ["read"],
        },
      }),
      createClient: () => buildFakeMcpClient(),
    });
    const response = await handler(
      new NextRequest("https://mogplex.example/api/v1/mogplex/mcp", {
        method: "POST",
        headers: {
          authorization: "Bearer mog_valid",
          origin: "https://chat.example.com",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
      })
    );

    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get("access-control-allow-origin"),
      "https://chat.example.com"
    );
  } finally {
    if (originalAllowedOrigins === undefined) {
      delete process.env.MOGPLEX_MCP_ALLOWED_ORIGINS;
    } else {
      process.env.MOGPLEX_MCP_ALLOWED_ORIGINS = originalAllowedOrigins;
    }
  }
});

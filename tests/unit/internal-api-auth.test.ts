import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMachineApiAuthFailureResponse,
  buildInternalApiHeaders,
  getDelegatedUserIdFromRequest,
  getMachineApiAuthResult,
  hasPlaywrightAuthBypass,
} from "../../lib/internal-api-auth";
import {
  allowsCliPatApiPath as allowsCliPatApiAuth,
  allowsDelegatedInternalApiPath as allowsInternalApiAuth,
  allowsMachineApiPath as allowsMachineApiAuth,
} from "../../lib/auth-route-policy";

function withEnv<T>(
  overrides: Record<string, string | undefined>,
  callback: () => T
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
    return callback();
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

test("buildInternalApiHeaders signs delegated internal requests", () => {
  withEnv({ INTERNAL_API_SECRET: "internal-secret" }, () => {
    assert.deepEqual(buildInternalApiHeaders("user-123"), {
      "Content-Type": "application/json",
      Authorization: "Bearer internal-secret",
      "X-Delegated-User-Id": "user-123",
    });
  });
});

test("buildInternalApiHeaders carries team scope for delegated internal requests", () => {
  withEnv({ INTERNAL_API_SECRET: "internal-secret" }, () => {
    assert.deepEqual(
      buildInternalApiHeaders("user-123", {
        teamId: "00000000-0000-4000-8000-000000000123",
      }),
      {
        "Content-Type": "application/json",
        Authorization: "Bearer internal-secret",
        "X-Delegated-User-Id": "user-123",
        "x-mogplex-team-id": "00000000-0000-4000-8000-000000000123",
      }
    );
  });
});

test("getDelegatedUserIdFromRequest rejects missing or invalid internal auth", () => {
  withEnv({ INTERNAL_API_SECRET: "internal-secret" }, () => {
    const invalidRequest = new Request("http://localhost/api/sandbox", {
      headers: {
        Authorization: "Bearer wrong-secret",
        "X-Delegated-User-Id": "user-123",
      },
    });

    assert.equal(getDelegatedUserIdFromRequest(invalidRequest), null);

    const validRequest = new Request("http://localhost/api/sandbox", {
      headers: {
        Authorization: "Bearer internal-secret",
        "X-Delegated-User-Id": "user-123",
      },
    });

    assert.equal(getDelegatedUserIdFromRequest(validRequest), "user-123");
  });
});

test("allowsInternalApiAuth scopes delegated auth to sandbox routes", () => {
  assert.equal(allowsInternalApiAuth("/api/sandbox"), true);
  assert.equal(allowsInternalApiAuth("/api/sandbox/sandbox-1/exec"), true);
  assert.equal(allowsInternalApiAuth("/api/settings"), false);
});

test("allowsMachineApiAuth scopes cron and automation starter routes", () => {
  assert.equal(allowsMachineApiAuth("/api/cron/repair-jobs"), true);
  assert.equal(allowsMachineApiAuth("/api/agent/review"), true);
  assert.equal(allowsMachineApiAuth("/api/jobs/process"), true);
  assert.equal(allowsMachineApiAuth("/api/sandbox"), false);
});

test("allowsCliPatApiAuth is limited to PAT-aware hosted CLI endpoints", () => {
  assert.equal(allowsCliPatApiAuth("/api/settings"), true);
  assert.equal(allowsCliPatApiAuth("/api/models"), true);
  assert.equal(allowsCliPatApiAuth("/api/mcp-servers"), true);
  // /api/sandbox collection and its sub-resources (stop, delete, …) all
  // delegate auth to the route handler's getResolvedAuth check.
  assert.equal(allowsCliPatApiAuth("/api/sandbox"), true);
  assert.equal(allowsCliPatApiAuth("/api/sandbox/sandbox-1/stop"), true);
  assert.equal(
    allowsCliPatApiAuth("/api/cli/inference/chat/completions"),
    true
  );
  assert.equal(allowsCliPatApiAuth("/api/cli/openai/chat/completions"), true);
  assert.equal(allowsCliPatApiAuth("/api/skills/registry"), false);
  assert.equal(allowsCliPatApiAuth("/api/cron/repair-jobs"), false);
  // Prefix must not leak to sibling path (/api/sandboxfoo).
  assert.equal(allowsCliPatApiAuth("/api/sandboxfoo"), false);
  assert.equal(allowsCliPatApiAuth("/spaces"), false);
});

test("getMachineApiAuthResult returns not_applicable for non-machine routes", () => {
  const request = new Request("http://localhost/api/sandbox");
  assert.deepEqual(getMachineApiAuthResult(request, "/api/sandbox"), {
    type: "not_applicable",
  });
});

test("getMachineApiAuthResult authorizes valid machine credentials", () => {
  withEnv({ CRON_SECRET: "cron-secret" }, () => {
    const request = new Request("http://localhost/api/cron/repair-jobs", {
      headers: { Authorization: "Bearer cron-secret" },
    });

    assert.deepEqual(
      getMachineApiAuthResult(request, "/api/cron/repair-jobs"),
      {
        type: "authorized",
      }
    );
  });
});

test("getMachineApiAuthResult rejects missing or invalid machine credentials", () => {
  withEnv({ CRON_SECRET: "cron-secret" }, () => {
    const missingHeader = new Request("http://localhost/api/agent/review");
    const invalidHeader = new Request("http://localhost/api/jobs/process", {
      headers: { Authorization: "Bearer wrong-secret" },
    });

    assert.deepEqual(
      getMachineApiAuthResult(missingHeader, "/api/agent/review"),
      { type: "unauthorized" }
    );
    assert.deepEqual(
      getMachineApiAuthResult(invalidHeader, "/api/jobs/process"),
      { type: "unauthorized" }
    );
  });
});

test("getMachineApiAuthResult fails closed when CRON_SECRET is missing", () => {
  withEnv({ CRON_SECRET: undefined }, () => {
    const request = new Request("http://localhost/api/cron/repair-jobs");
    assert.deepEqual(
      getMachineApiAuthResult(request, "/api/cron/repair-jobs"),
      { type: "missing_secret" }
    );
  });
});

test("buildMachineApiAuthFailureResponse returns stable auth and config responses", async () => {
  const unauthorized = buildMachineApiAuthFailureResponse({
    type: "unauthorized",
  });
  assert.equal(unauthorized.status, 401);
  assert.deepEqual(await unauthorized.json(), { error: "Unauthorized" });

  const missingSecret = buildMachineApiAuthFailureResponse({
    type: "missing_secret",
  });
  assert.equal(missingSecret.status, 503);
  assert.deepEqual(await missingSecret.json(), {
    error: "CRON_SECRET_NOT_CONFIGURED",
  });
});

test("hasPlaywrightAuthBypass only works with the configured secret", () => {
  withEnv(
    {
      PLAYWRIGHT: "1",
      PLAYWRIGHT_AUTH_BYPASS_SECRET: "playwright-auth-bypass",
    },
    () => {
      const request = new Request("http://localhost/", {
        headers: { "x-mogplex-e2e-auth": "playwright-auth-bypass" },
      });
      const invalidRequest = new Request("http://localhost/", {
        headers: { "x-mogplex-e2e-auth": "wrong-secret" },
      });

      assert.equal(hasPlaywrightAuthBypass(request), true);
      assert.equal(hasPlaywrightAuthBypass(invalidRequest), false);
    }
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  allowsCliPatApiPath,
  allowsDelegatedInternalApiPath,
  allowsMachineApiPath,
  isPublicRoutePath,
} from "../../lib/auth-route-policy";

test("isPublicRoutePath preserves exact, child-path, and sibling boundary behavior", () => {
  assert.equal(isPublicRoutePath("/install.sh"), true);
  assert.equal(isPublicRoutePath("/api/auth/session"), true);
  assert.equal(isPublicRoutePath("/login/callback"), true);
  assert.equal(isPublicRoutePath("/slack/link"), true);
  assert.equal(isPublicRoutePath("/api/cli/latest/assets"), true);
  assert.equal(isPublicRoutePath("/oauth/consent"), true);
  assert.equal(isPublicRoutePath("/api/oauth/decision"), true);
  assert.equal(isPublicRoutePath("/api/v1/mogplex/mcp"), true);
  assert.equal(
    isPublicRoutePath(
      "/.well-known/oauth-protected-resource/api/v1/mogplex/mcp"
    ),
    true
  );

  assert.equal(isPublicRoutePath("/install.shXXX"), false);
  assert.equal(isPublicRoutePath("/slack/link/anything"), false);
  assert.equal(isPublicRoutePath("/loginfoo"), false);
  assert.equal(isPublicRoutePath("/privacy-policy"), false);
  assert.equal(isPublicRoutePath("/api/agents"), false);
  assert.equal(isPublicRoutePath("/api/v1/mogplex/mcp/servers"), false);
});

test("allowsDelegatedInternalApiPath is limited to sandbox routes", () => {
  assert.equal(allowsDelegatedInternalApiPath("/api/sandbox"), true);
  assert.equal(
    allowsDelegatedInternalApiPath("/api/sandbox/sandbox-1/exec"),
    true
  );

  assert.equal(allowsDelegatedInternalApiPath("/api/sandboxfoo"), false);
  assert.equal(allowsDelegatedInternalApiPath("/api/settings"), false);
});

test("allowsMachineApiPath covers cron and machine entrypoints without leaking to siblings", () => {
  assert.equal(allowsMachineApiPath("/api/cron/repair-jobs"), true);
  assert.equal(allowsMachineApiPath("/api/cron/production-smoke"), true);
  assert.equal(allowsMachineApiPath("/api/agent/review"), true);
  assert.equal(allowsMachineApiPath("/api/jobs/process"), true);

  assert.equal(allowsMachineApiPath("/api/cronfoo"), false);
  assert.equal(allowsMachineApiPath("/api/agent/review/details"), false);
  assert.equal(allowsMachineApiPath("/api/jobs/process/retry"), false);
  assert.equal(allowsMachineApiPath("/api/jobs/process-extra"), false);
  assert.equal(allowsMachineApiPath("/api/sandbox"), false);
});

test("allowsCliPatApiPath keeps the PAT allowlist narrow and boundary-safe", () => {
  assert.equal(allowsCliPatApiPath("/api/settings"), true);
  assert.equal(allowsCliPatApiPath("/api/models"), true);
  assert.equal(allowsCliPatApiPath("/api/mcp-servers"), true);
  assert.equal(allowsCliPatApiPath("/api/sandbox"), true);
  assert.equal(allowsCliPatApiPath("/api/sandbox/sandbox-1/delete"), true);
  assert.equal(
    allowsCliPatApiPath("/api/cli/inference/chat/completions"),
    true
  );
  assert.equal(allowsCliPatApiPath("/api/cli/openai/chat/completions"), true);

  assert.equal(allowsCliPatApiPath("/api/models/custom"), false);
  assert.equal(
    allowsCliPatApiPath("/api/cli/inference/chat/completions/retry"),
    false
  );
  assert.equal(allowsCliPatApiPath("/api/sandboxfoo"), false);
  assert.equal(allowsCliPatApiPath("/api/skills/registry"), false);
  assert.equal(allowsCliPatApiPath("/api/cron/repair-jobs"), false);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  LOGIN_NEXT_FALLBACK,
  buildGithubLoginHref,
  defaultLoginNext,
  resolveAuthorizeResumeNext,
  resolveLoginError,
  resolveLoginNext,
} from "../../lib/login-next";

test("resolveLoginNext falls back to the sentinel for missing or unsafe values", () => {
  assert.equal(resolveLoginNext(null), LOGIN_NEXT_FALLBACK);
  assert.equal(resolveLoginNext(""), LOGIN_NEXT_FALLBACK);
  assert.equal(resolveLoginNext("https://evil.test"), LOGIN_NEXT_FALLBACK);
  assert.equal(resolveLoginNext("//evil.test/path"), LOGIN_NEXT_FALLBACK);
  assert.equal(resolveLoginNext("/%2F%2Fevil.test"), LOGIN_NEXT_FALLBACK);
  assert.equal(resolveLoginNext("/../settings"), LOGIN_NEXT_FALLBACK);
  assert.equal(resolveLoginNext("/%2e%2e/settings"), LOGIN_NEXT_FALLBACK);
  assert.equal(resolveLoginNext("/has whitespace"), LOGIN_NEXT_FALLBACK);
  assert.equal(resolveLoginNext("/has%20whitespace"), LOGIN_NEXT_FALLBACK);
  assert.equal(resolveLoginNext("/\\\\evil.test"), LOGIN_NEXT_FALLBACK);
  assert.equal(resolveLoginNext("/%5C%5Cevil.test"), LOGIN_NEXT_FALLBACK);
  assert.equal(resolveLoginNext("/has\0control"), LOGIN_NEXT_FALLBACK);
  assert.equal(resolveLoginNext("/broken-%"), LOGIN_NEXT_FALLBACK);
});

test("resolveLoginNext preserves same-origin relative paths", () => {
  const cliAuthPath =
    "/cli-auth?callback=http%3A%2F%2Flocalhost%3A45454%2Fcallback";

  assert.equal(resolveLoginNext(cliAuthPath), cliAuthPath);
});

test("resolveAuthorizeResumeNext rebuilds the authorize URL from an OAuth login query", () => {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: "mogplex-cli",
    redirect_uri: "http://127.0.0.1:24816/auth/callback",
    scope: "openid offline_access read write",
    state: "abc123",
    code_challenge: "xyz",
    code_challenge_method: "S256",
  });

  const next = resolveAuthorizeResumeNext(params);
  assert.ok(next);
  assert.ok(next.startsWith("/api/auth/mcp/authorize?"));
  const rebuilt = new URLSearchParams(next.split("?")[1]);
  assert.equal(rebuilt.get("client_id"), "mogplex-cli");
  assert.equal(
    rebuilt.get("redirect_uri"),
    "http://127.0.0.1:24816/auth/callback"
  );
  assert.equal(rebuilt.get("scope"), "openid offline_access read write");
  assert.equal(rebuilt.get("code_challenge_method"), "S256");
});

test("resolveAuthorizeResumeNext drops non-allowlisted params", () => {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: "mogplex-cli",
    redirect_uri: "http://127.0.0.1:24816/auth/callback",
    evil: "https://attacker.example/steal",
  });

  const next = resolveAuthorizeResumeNext(params);
  assert.ok(next);
  assert.ok(!next.includes("evil"));
});

test("resolveAuthorizeResumeNext returns null for non-OAuth queries", () => {
  assert.equal(resolveAuthorizeResumeNext(new URLSearchParams()), null);
  assert.equal(
    resolveAuthorizeResumeNext(new URLSearchParams({ next: "/dashboard" })),
    null
  );
  assert.equal(
    resolveAuthorizeResumeNext(new URLSearchParams({ client_id: "x" })),
    null
  );
});

test("defaultLoginNext returns the scoped workspace path", () => {
  assert.equal(defaultLoginNext("alex"), "/alex/projects/workspace");
  assert.equal(defaultLoginNext("acme-team"), "/acme-team/projects/workspace");
});

test("resolveLoginError accepts only known route error code shape", () => {
  assert.equal(resolveLoginError("github_token_store"), "github_token_store");
  assert.equal(resolveLoginError("GithubTokenStore"), null);
  assert.equal(resolveLoginError("../github_token_store"), null);
});

test("buildGithubLoginHref encodes the next path once", () => {
  assert.equal(
    buildGithubLoginHref(
      "/cli-auth?callback=http%3A%2F%2Flocalhost%3A45454%2Fcallback"
    ),
    "/api/auth/login/github?next=%2Fcli-auth%3Fcallback%3Dhttp%253A%252F%252Flocalhost%253A45454%252Fcallback"
  );
});

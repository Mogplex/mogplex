import assert from "node:assert/strict";
import test from "node:test";
import {
  LOGIN_NEXT_FALLBACK,
  buildGithubLoginHref,
  defaultLoginNext,
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
  assert.equal(resolveLoginNext("/broken-%"), LOGIN_NEXT_FALLBACK);
});

test("resolveLoginNext preserves same-origin relative paths", () => {
  const cliAuthPath =
    "/cli-auth?callback=http%3A%2F%2Flocalhost%3A45454%2Fcallback";

  assert.equal(resolveLoginNext(cliAuthPath), cliAuthPath);
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

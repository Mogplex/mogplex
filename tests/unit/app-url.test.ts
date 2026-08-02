import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAppUrl,
  getCanonicalAppUrl,
  normalizeAppRedirectPath,
} from "../../lib/app-url";

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

test("buildAppUrl prefers NEXT_PUBLIC_APP_URL over the request host", () => {
  const url = withEnv(
    {
      NEXT_PUBLIC_APP_URL: "https://app.mogplex.example",
      VERCEL_URL: undefined,
      APP_URL: undefined,
    },
    () =>
      buildAppUrl(
        "/settings?tab=connections",
        new Request("https://evil.example/login")
      )
  );

  assert.equal(
    url.toString(),
    "https://app.mogplex.example/settings?tab=connections"
  );
});

test("getCanonicalAppUrl falls back to VERCEL_URL when app url is unset", () => {
  const url = withEnv(
    {
      NEXT_PUBLIC_APP_URL: undefined,
      APP_URL: undefined,
      VERCEL_URL: "mogplex-preview.vercel.app",
    },
    () => getCanonicalAppUrl()
  );

  assert.equal(url.toString(), "https://mogplex-preview.vercel.app/");
});

test("getCanonicalAppUrl falls back to the request origin in local development", () => {
  const url = withEnv(
    {
      NEXT_PUBLIC_APP_URL: undefined,
      APP_URL: undefined,
      VERCEL_URL: undefined,
    },
    () => getCanonicalAppUrl(new Request("http://localhost:3000/workspace"))
  );

  assert.equal(url.toString(), "http://localhost:3000/");
});

test("normalizeAppRedirectPath preserves app-relative query and hash fragments", () => {
  assert.equal(
    normalizeAppRedirectPath("/workspace/abc?tab=files#preview"),
    "/workspace/abc?tab=files#preview"
  );
});

test("normalizeAppRedirectPath rejects absolute and protocol-relative targets", () => {
  assert.equal(normalizeAppRedirectPath("https://evil.example/phish"), "/");
  assert.equal(normalizeAppRedirectPath("//evil.example/phish"), "/");
  assert.equal(normalizeAppRedirectPath("settings"), "/");
});

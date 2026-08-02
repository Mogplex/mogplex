import assert from "node:assert/strict";
import test from "node:test";

test("next config includes a baseline content security policy", async () => {
  const { buildContentSecurityPolicy, default: nextConfig } =
    await import("../../next.config.mjs");
  assert.equal(typeof nextConfig.headers, "function");

  const entries = await nextConfig.headers!();
  const globalEntry = entries.find((entry) => entry.source === "/(.*)");

  assert.ok(globalEntry, "expected a global headers entry");

  const headerMap = Object.fromEntries(
    globalEntry.headers.map((header) => [header.key, header.value])
  );

  assert.match(headerMap["Content-Security-Policy"], /default-src 'self';/);
  assert.match(headerMap["Content-Security-Policy"], /frame-ancestors 'none';/);
  assert.match(
    headerMap["Content-Security-Policy"],
    /script-src [^;]*https:\/\/va\.vercel-scripts\.com/
  );
  // Monaco Editor relies on `new Function()` to compile language workers, so
  // 'unsafe-eval' must be present in every environment.
  assert.match(
    buildContentSecurityPolicy({ isDevelopment: false }),
    /script-src [^;]*'unsafe-eval'/
  );
  assert.match(
    buildContentSecurityPolicy({ isDevelopment: true }),
    /script-src [^;]*'unsafe-eval'/
  );
  assert.match(
    buildContentSecurityPolicy({ isDevelopment: false }),
    /script-src [^;]*blob:/
  );
  assert.match(
    buildContentSecurityPolicy({ isDevelopment: false }),
    /upgrade-insecure-requests/
  );
  assert.doesNotMatch(
    buildContentSecurityPolicy({ isDevelopment: true }),
    /upgrade-insecure-requests/
  );
  assert.equal(
    headerMap["Strict-Transport-Security"],
    "max-age=63072000; includeSubDomains; preload"
  );
});

test("next config keeps the public homepage at root", async () => {
  const { default: nextConfig } = await import("../../next.config.mjs");
  assert.equal(typeof nextConfig.redirects, "function");

  const redirects = await nextConfig.redirects!();

  assert.equal(
    redirects.some((redirect) => redirect.source === "/"),
    false
  );
});

test("next config redirects legacy icon filenames before they reach the scope route", async () => {
  const { default: nextConfig } = await import("../../next.config.mjs");
  assert.equal(typeof nextConfig.redirects, "function");

  const redirects = await nextConfig.redirects!();

  for (const [source, destination] of [
    ["/favicon.png", "/favicon.ico"],
    ["/apple-touch-icon.png", "/apple-icon.png"],
    ["/apple-touch-icon-precomposed.png", "/apple-icon.png"],
  ] as const) {
    const redirect = redirects.find((entry) => entry.source === source);

    assert.ok(redirect, `expected a redirect for ${source}`);
    assert.equal(redirect.destination, destination);
    assert.equal(redirect.permanent, true);
  }
});

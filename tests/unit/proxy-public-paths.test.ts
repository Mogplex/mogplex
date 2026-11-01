import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  SENTRY_TUNNEL_ROUTE,
  isPublicRoutePath,
  isStraySentryTunnelRequest,
  isUnscopedAuthedRoutePath,
  unscopedRouteTopLevelSegments,
} from "../../lib/auth-route-policy";
import { isReservedSlug } from "../../lib/reserved-slugs";

test("checkout is authenticated but never interpreted as a workspace slug", () => {
  assert.equal(isPublicRoutePath("/checkout"), false);
  assert.equal(isUnscopedAuthedRoutePath("/checkout"), true);
  assert.equal(isUnscopedAuthedRoutePath("/checkout/complete"), true);
  assert.equal(isUnscopedAuthedRoutePath("/checkout-old"), false);
});

test("isPublicRoutePath exact-matches script endpoints", () => {
  assert.equal(isPublicRoutePath("/install.sh"), true);
  assert.equal(isPublicRoutePath("/install.ps1"), true);
});

test("isPublicRoutePath allows the public homepage", () => {
  assert.equal(isPublicRoutePath("/"), true);
});

test("isPublicRoutePath exact-matches metadata files", () => {
  assert.equal(isPublicRoutePath("/robots.txt"), true);
  assert.equal(isPublicRoutePath("/robots.txt/more"), false);
  assert.equal(isPublicRoutePath("/sitemap.xml"), true);
  assert.equal(isPublicRoutePath("/sitemap.xml/more"), false);
  assert.equal(isPublicRoutePath("/manifest.webmanifest"), true);
  assert.equal(isPublicRoutePath("/manifest.webmanifest/more"), false);
});

test("isPublicRoutePath exact-matches /api/cli/latest", () => {
  assert.equal(isPublicRoutePath("/api/cli/latest"), true);
});

test("isPublicRoutePath does not leak past path boundaries", () => {
  // startsWith would have let these through; the new matcher must not.
  assert.equal(isPublicRoutePath("/api/cli/latest-beta"), false);
  assert.equal(isPublicRoutePath("/api/cli/latestv2"), false);
  assert.equal(isPublicRoutePath("/install.shXXX"), false);
  assert.equal(isPublicRoutePath("/install.ps1.bak"), false);
  assert.equal(isPublicRoutePath("/loginfoo"), false);
  assert.equal(isPublicRoutePath("/privacy-policy"), false);
});

test("isPublicRoutePath allows child paths of exact-match entries", () => {
  // Exact-match entries should still cover their child paths so sub-resources
  // keep working (e.g. a hypothetical /login/callback, /api/cli/latest/foo).
  assert.equal(isPublicRoutePath("/login/callback"), true);
  assert.equal(isPublicRoutePath("/api/cli/latest/assets"), true);
});

test("isPublicRoutePath still treats trailing-slash entries as prefix matches", () => {
  assert.equal(isPublicRoutePath("/api/auth/session"), true);
  assert.equal(isPublicRoutePath("/api/webhooks/stripe"), true);
});

test("isPublicRoutePath rejects unrelated app paths", () => {
  assert.equal(isPublicRoutePath("/dashboard"), false);
  assert.equal(isPublicRoutePath("/api/agents"), false);
});

test("isPublicRoutePath preserves legacy bare-entry behavior at path boundaries", () => {
  // Each legacy entry: exact match and child-path match must pass;
  // sibling-prefix match (the original startsWith bug) must not.
  const cases: Array<[string, boolean, string]> = [
    ["/login", true, "exact"],
    ["/login/callback", true, "child"],
    ["/loginfoo", false, "sibling"],
    ["/auth/callback", true, "exact"],
    ["/auth/callback/foo", true, "child"],
    ["/auth/callbackXXX", false, "sibling"],
    ["/auth/error", true, "exact"],
    ["/auth/error-page", false, "sibling"],
    ["/privacy", true, "exact"],
    ["/privacy-policy", false, "sibling"],
    ["/terms", true, "exact"],
    ["/terms-of-service", false, "sibling"],
    ["/conduct", true, "exact"],
    ["/conduct-report", false, "sibling"],
  ];
  for (const [input, expected, kind] of cases) {
    assert.equal(
      isPublicRoutePath(input),
      expected,
      `${kind} "${input}" should be ${expected}`
    );
  }
});

test("every unscoped top-level route segment is a reserved slug", () => {
  const unreserved = [...unscopedRouteTopLevelSegments()].filter(
    (segment) => !isReservedSlug(segment)
  );
  assert.deepEqual(unreserved, []);
});

test("the Sentry tunnel route matches next.config.mjs", async () => {
  const nextConfig = await readFile(
    new URL("../../next.config.mjs", import.meta.url),
    "utf8"
  );
  assert.match(nextConfig, new RegExp(`\\? "${SENTRY_TUNNEL_ROUTE}"`));
  assert.match(nextConfig, /MOGPLEX_SENTRY_TUNNEL_ROUTE: sentryTunnelRoute/);
  assert.match(nextConfig, /tunnelRoute: sentryTunnelRoute/);
});

test("isStraySentryTunnelRequest passes only requests the Sentry rewrite matches", () => {
  const cases: Array<[string, boolean]> = [
    ["/monitoring?o=4507&p=4508", false],
    ["/monitoring/?o=4507&p=4508", false],
    ["/monitoring?o=&p=", true],
    ["/monitoring?o=4507&p=", true],
    ["/monitoring?o=4507&p=4508&r=us", false],
    ["/monitoring", true],
    ["/monitoring?o=4507", true],
    ["/monitoring?o=abc&p=4508", true],
    ["/monitoring/extra?o=4507&p=4508", true],
    ["/monitoring-dashboard", false],
    ["/agents", false],
  ];
  for (const [path, stray] of cases) {
    assert.equal(
      isStraySentryTunnelRequest(new URL(path, "https://mogplex.com"), true),
      stray,
      path
    );
  }
});

test("the Sentry SDK still builds tunnel URLs with numeric o and p", async () => {
  // The stray check mirrors this format; an SDK upgrade that changes it must
  // fail here rather than silently 404 every browser error envelope.
  const sdkSource = await readFile(
    new URL(
      "../../node_modules/@sentry/nextjs/build/cjs/client/tunnelRoute.js",
      import.meta.url
    ),
    "utf8"
  );
  assert.match(sdkSource, /\?o=\$\{orgId\}&p=\$\{dsnComponents\.projectId\}/);
});

test("isStraySentryTunnelRequest treats the whole path as stray without a tunnel", () => {
  const url = (path: string) => new URL(path, "https://mogplex.com");
  assert.equal(
    isStraySentryTunnelRequest(url("/monitoring?o=4507&p=4508"), false),
    true
  );
  assert.equal(isStraySentryTunnelRequest(url("/monitoring"), false), true);
  assert.equal(isStraySentryTunnelRequest(url("/agents"), false), false);
});

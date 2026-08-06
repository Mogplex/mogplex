import assert from "node:assert/strict";
import test from "node:test";
import { DASHBOARD_SCOPED_FIRST_SEGMENTS } from "../../lib/dashboard-rescue";
import { isPublicRoutePath } from "../../lib/auth-route-policy";
import {
  NO_INDEX_ROBOTS,
  PRIVATE_NO_INDEX_ROBOTS,
  PUBLIC_CONTENT_ROUTES,
  SOCIAL_IMAGE,
  absoluteUrl,
  buildMarketingMetadata,
} from "../../lib/seo";

test("sitemap exposes only public content routes", async () => {
  const { default: sitemap } = await import("../../app/sitemap");
  const urls = sitemap().map((entry) => entry.url);

  assert.deepEqual(
    urls,
    PUBLIC_CONTENT_ROUTES.map((route) => absoluteUrl(route.path))
  );
  assert.ok(!urls.some((url) => url.includes("/login")));
  assert.ok(!urls.some((url) => url.includes("/api/")));
  assert.ok(!urls.some((url) => url.includes("/invite/")));
  assert.ok(!urls.some((url) => url.includes("/request-access")));
});

test("sitemap routes stay aligned with the public route policy", () => {
  for (const route of PUBLIC_CONTENT_ROUTES) {
    assert.equal(isPublicRoutePath(route.path), true, route.path);
  }
});

test("marketing metadata includes the shared Open Graph image", () => {
  const metadata = buildMarketingMetadata({ path: "/" });

  assert.deepEqual(metadata.openGraph?.images, [SOCIAL_IMAGE]);
  assert.deepEqual(metadata.twitter?.images, [SOCIAL_IMAGE]);
});

test("web app manifest exposes installable and maskable icons", async () => {
  const { default: manifest } = await import("../../app/manifest");
  const metadata = manifest();

  assert.equal(metadata.start_url, "/");
  assert.equal(metadata.display, "standalone");
  assert.deepEqual(metadata.icons, [
    {
      src: "/web-app-manifest-192x192.png",
      sizes: "192x192",
      type: "image/png",
      purpose: "any",
    },
    {
      src: "/web-app-manifest-512x512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "any",
    },
    {
      src: "/web-app-manifest-512x512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable",
    },
  ]);
});

test("robots blocks auth, API, and scoped dashboard surfaces", async () => {
  const { default: robots } = await import("../../app/robots");
  const route = robots();
  const rules = Array.isArray(route.rules) ? route.rules[0] : route.rules;
  const disallow = Array.isArray(rules.disallow)
    ? rules.disallow
    : [rules.disallow];

  assert.equal(route.sitemap, absoluteUrl("/sitemap.xml"));
  assert.equal(route.host, undefined);
  assert.ok(rules.allow?.includes("/llms.txt"));
  assert.ok(disallow.includes("/api/"));
  assert.ok(disallow.includes("/login"));
  assert.ok(disallow.includes("/invite/"));

  for (const segment of DASHBOARD_SCOPED_FIRST_SEGMENTS) {
    assert.ok(disallow.includes(`/${segment}`));
    assert.ok(disallow.includes(`/*/${segment}`));
  }
});

test("robots presets separate public noindex pages from private nofollow pages", () => {
  assert.deepEqual(NO_INDEX_ROBOTS, { index: false, follow: true });
  assert.deepEqual(PRIVATE_NO_INDEX_ROBOTS, {
    index: false,
    follow: false,
  });
});

test("login-style pages use noindex while allowing link discovery", async () => {
  const [{ metadata: loginMetadata }, { metadata: newCodeMetadata }] =
    await Promise.all([
      import("../../app/login/page"),
      import("../../app/login/new-code/page"),
    ]);

  assert.equal(loginMetadata.robots, NO_INDEX_ROBOTS);
  assert.equal(newCodeMetadata.robots, NO_INDEX_ROBOTS);
});

test("private auth handoff pages use noindex and nofollow", async () => {
  const [{ metadata: authErrorMetadata }, { metadata: cliAuthMetadata }] =
    await Promise.all([
      import("../../app/auth/error/page"),
      import("../../app/cli-auth/page"),
    ]);

  assert.equal(authErrorMetadata.robots, PRIVATE_NO_INDEX_ROBOTS);
  assert.equal(cliAuthMetadata.robots, PRIVATE_NO_INDEX_ROBOTS);
});

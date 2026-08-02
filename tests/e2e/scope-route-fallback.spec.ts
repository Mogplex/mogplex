import { expect, test } from "@playwright/test";

test("an unmatched image-like root path returns 404 instead of a scope error", async ({
  request,
}) => {
  const response = await request.get("/__scope-fallback-probe.png");

  expect(response.status()).toBe(404);
});

test("the legacy precomposed Apple icon redirects to the canonical asset", async ({
  request,
}) => {
  const response = await request.get("/apple-touch-icon-precomposed.png", {
    maxRedirects: 0,
  });

  expect(response.status()).toBe(308);
  expect(response.headers().location).toBe("/apple-icon.png");
});

import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  fulfillJson,
  mockBaseChrome,
  mockControlSessionBootstrap,
} from "./helpers/automation-control-plane-fixtures";

test("Control renders and subscribes to Neon events without Supabase configuration", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  const legacyRequests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (/supabase\.(co|in)/.test(request.url()))
      legacyRequests.push(request.url());
  });
  await enableScopedE2EAuth(page);
  await mockBaseChrome(page);
  await mockControlSessionBootstrap(page);
  const session = {
    id: "neon-session",
    title: "Neon session",
    project: "acme/widgets",
    repo_id: null,
    pinned: false,
    archived: false,
    messages: [],
    created_at: "2026-09-06T00:00:00.000Z",
    updated_at: "2026-09-06T00:00:00.000Z",
  };
  await page.route("**/api/control/sessions**", (route) =>
    fulfillJson(
      route,
      new URL(route.request().url()).searchParams.has("id")
        ? session
        : [session]
    )
  );
  await page.route("**/api/integrations/slack/installations", (route) =>
    fulfillJson(route, { installations: [] })
  );
  const events = page.waitForRequest(
    (request) =>
      request.url().includes("/api/realtime/events?") &&
      request.url().includes("control_sessions")
  );
  await page.goto(scopedPath("control?mission=neon-session"));
  await expect(
    page.getByRole("complementary", { name: "Sessions" })
  ).toBeVisible();
  await events;
  await expect(
    page.getByText("Something went wrong", { exact: true })
  ).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(legacyRequests).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("control-neon.png") });
});

test("old GitHub login and callback links restart on the current login page", async ({
  request,
}) => {
  const next = "/invite/example-token";
  for (const path of [
    "/api/auth/login/github",
    "/auth/callback?code=old-code",
  ]) {
    const separator = path.includes("?") ? "&" : "?";
    const response = await request.get(
      `${path}${separator}next=${encodeURIComponent(next)}`,
      { maxRedirects: 0 }
    );
    expect(response.status()).toBe(307);
    const location = new URL(response.headers().location);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe(next);
    expect(location.searchParams.has("code")).toBe(false);
  }
});

test("retired OAuth consent explains how to restart instead of initializing Supabase", async ({
  page,
}) => {
  await page.goto(
    "/oauth/consent?authorization_id=11111111-1111-4111-8111-111111111111"
  );
  await expect(
    page.getByText(/Start a new connection from your MCP client/)
  ).toBeVisible();
  await expect(
    page.getByText("Something went wrong", { exact: true })
  ).toHaveCount(0);
});

import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";

test("an old page keeps its API release and unsaved form after schema drift", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  const pins: Array<string | undefined> = [];
  const writes: unknown[] = [];
  let schemaRepaired = false;
  let deploymentPromoted = false;
  await page.route("**/api/auth/user", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "user-1",
          username: "alex",
          github_connected: true,
          github_app_connected: true,
        },
      },
    })
  );
  await page.route(/\/api\/repos(?:\?.*)?$/, (route) =>
    route.fulfill({ json: [] })
  );
  await page.route("**/api/integrations/slack/installations", (route) =>
    route.fulfill({ json: { installations: [] } })
  );
  await page.route(/\/api\/mcp-servers(?:\?.*)?$/, async (route) => {
    const request = route.request();
    pins.push(request.headers()["x-deployment-id"]);
    if (request.method() === "GET") {
      // Simulate the platform: unpinned requests switch after promotion.
      await (deploymentPromoted && !request.headers()["x-deployment-id"]
        ? route.fulfill({ status: 500, json: { error: "wrong release" } })
        : route.fulfill({ json: { servers: [] } }));
      return;
    }
    writes.push(request.postDataJSON());
    await route.fulfill(
      schemaRepaired
        ? { status: 201, json: { server: { id: "server-1" } } }
        : {
            status: 500,
            json: {
              code: "42703",
              error: "private_column does not exist",
              details: "private schema",
            },
          }
    );
  });
  await page.goto(scopedPath("settings/mcp"));
  await page.getByRole("button", { name: "Add server" }).click();
  await page.getByLabel("Name").fill("My unsaved server");
  await page.getByLabel("Command").fill("npx");
  const documentToken = await page.evaluate(() => {
    const value = crypto.randomUUID();
    document.documentElement.setAttribute("data-session-token", value);
    return value;
  });
  deploymentPromoted = true;
  await page.screenshot({
    path: "test-results/deployment-before-drift.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Create server" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByLabel("Name")).toHaveValue("My unsaved server");
  await expect(
    page.getByRole("dialog").getByText(/Keep this tab open/)
  ).toBeVisible();
  await expect(
    page.locator('[role="alert"]').filter({ hasText: "Keep this tab open" })
  ).toHaveCount(1);
  await expect(page.locator("body")).not.toContainText("private_column");
  expect(writes).toHaveLength(1);
  expect(pins.length).toBeGreaterThan(1);
  expect(
    pins.every(
      (pin) => pin === `playwright-${process.env.PLAYWRIGHT_PORT || 3000}`
    )
  ).toBe(true);
  expect(await page.locator("html").getAttribute("data-session-token")).toBe(
    documentToken
  );
  await page.screenshot({
    path: "test-results/deployment-schema-drift.png",
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Create server" })
    .scrollIntoViewIfNeeded();
  const notice = await page
    .locator('[role="alert"]')
    .filter({ hasText: "Keep this tab open" })
    .boundingBox();
  const create = await page
    .getByRole("button", { name: "Create server" })
    .boundingBox();
  expect(notice).not.toBeNull();
  expect(create).not.toBeNull();
  expect(notice!.y + notice!.height).toBeLessThan(create!.y);
  await page.screenshot({
    path: "test-results/deployment-schema-drift-mobile.png",
    fullPage: true,
  });

  schemaRepaired = true;
  await page.getByRole("button", { name: "Create server" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(writes).toHaveLength(2);
  expect(writes[1]).toEqual(writes[0]);
  await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(
    page.locator('[role="alert"]').filter({ hasText: "Keep this tab open" })
  ).toHaveCount(0);
});

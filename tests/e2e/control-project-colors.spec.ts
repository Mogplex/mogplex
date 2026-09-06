import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  fulfillJson,
  mockBaseChrome,
} from "./helpers/automation-control-plane-fixtures";

test("project identity colors stay distinct and stable across sorting and themes", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockBaseChrome(page);
  const projects = [
    "acme/alpha",
    "acme/beta",
    "acme/gamma",
    "Mogplex/mogplex",
    "mogplex",
    null,
  ];
  await page.route("**/api/control/sessions**", (route) =>
    fulfillJson(
      route,
      projects.map((project, i) => ({
        id: `session-${i}`,
        title: `Conversation ${i}`,
        project,
        repo_id: null,
        pinned: false,
        updated_at: new Date(2026, 8, 5, 12 - i).toISOString(),
      }))
    )
  );
  await page.goto(scopedPath("control"));
  const sidebar = page.getByRole("complementary", { name: "Sessions" });
  const names = projects.map((project) => project ?? "General");
  const colors = async () =>
    Promise.all(
      names.map(async (name) => {
        const dot = sidebar
          .getByRole("button", { name: `${name} 1`, exact: true })
          .locator('span[aria-hidden="true"]');
        await expect(dot).toBeVisible();
        return dot.evaluate((node) => getComputedStyle(node).backgroundColor);
      })
    );
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  const dark = await colors();
  expect(new Set(dark).size).toBe(names.length);
  expect(dark).not.toContain("rgba(0, 0, 0, 0)");
  await sidebar.getByRole("button", { name: /Sort/ }).click();
  expect(await colors()).toEqual(dark);
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
  const light = await colors();
  expect(new Set(light).size).toBe(names.length);
  expect(light).not.toContain("rgba(0, 0, 0, 0)");
  for (const [i, color] of light.entries()) expect(color).not.toBe(dark[i]);
  await sidebar.screenshot({
    path: "test-results/control-project-geist-colors-light.png",
  });
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await sidebar.screenshot({
    path: "test-results/control-project-geist-colors.png",
  });
});

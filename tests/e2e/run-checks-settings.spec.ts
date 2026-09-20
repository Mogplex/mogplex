import { expect, test, type Route } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import { mockSettingsShell } from "./helpers/billing-settings-fixtures";

const ENDPOINT = "**/api/settings/decision-checks";

async function fulfillJson(route: Route, data: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(data),
  });
}

test("Account settings show Run checks on, say what is sent, and save a change", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockSettingsShell(page);

  let enabled = true;
  const patchBodies: unknown[] = [];
  await page.route(ENDPOINT, async (route) => {
    const request = route.request();
    if (request.method() === "PATCH") {
      const body = request.postDataJSON() as { enabled: boolean };
      patchBodies.push(body);
      enabled = body.enabled;
    }
    await fulfillJson(route, { enabled, viewer: { canManage: true } });
  });

  await page.goto(scopedPath("settings"));

  const toggle = page.getByRole("switch", { name: "Run checks" });
  await expect(toggle).toBeChecked();
  // The copy is the customer's only account of what leaves their workspace.
  await expect(
    page.getByText(
      /your request with the memories and\s+skill summaries loaded for it are sent/
    )
  ).toBeVisible();
  await expect(page.getByText(/When it is off, nothing is sent/)).toBeVisible();

  await toggle.click();

  await expect(toggle).not.toBeChecked();
  expect(patchBodies).toEqual([{ enabled: false }]);

  await page.reload();
  await expect(
    page.getByRole("switch", { name: "Run checks" })
  ).not.toBeChecked();
});

test("Run checks stays on and says so when the change cannot be saved", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockSettingsShell(page);

  await page.route(ENDPOINT, async (route) => {
    if (route.request().method() === "PATCH") {
      await fulfillJson(route, { error: "Unable to save run checks" }, 500);
      return;
    }
    await fulfillJson(route, { enabled: true, viewer: { canManage: true } });
  });

  await page.goto(scopedPath("settings"));

  const toggle = page.getByRole("switch", { name: "Run checks" });
  await expect(toggle).toBeChecked();
  await toggle.click();

  await expect(page.getByText("Unable to save run checks")).toBeVisible();
  await expect(toggle).toBeChecked();
});

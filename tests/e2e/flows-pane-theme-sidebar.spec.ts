import { expect, test } from "@playwright/test";
import {
  fulfillJson,
  setupWorkflowsPage,
} from "./helpers/flows-pane-theme-fixtures";

test("app sidebar owns primary navigation and supports drag and keyboard resize", async ({
  page,
}) => {
  await setupWorkflowsPage(page, "light");
  await page.route("**/api/memberships", (route) =>
    fulfillJson(route, {
      personal: { slug: "alex", name: "Alex", avatarUrl: null },
      teams: [],
    })
  );
  await page.route("**/api/billing/capacity", (route) =>
    fulfillJson(route, {
      version: "capacity_v2",
      plan: { name: "Plus" },
      account: { canManageBilling: true },
      hostedUsage: { spendableCents: 2_500 },
    })
  );
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");

  const sidebar = page.getByTestId("app-sidebar");
  await expect(sidebar).toBeVisible();
  await expect(sidebar.getByText("Plus", { exact: true })).toBeVisible();
  await expect(sidebar.getByText("$25.00 inference")).toBeVisible();
  await expect(
    sidebar.getByRole("link", { name: "Manage billing" })
  ).toBeVisible();
  for (const destination of [
    "control",
    "workspaces",
    "automations",
    "delivery",
    "observe",
    "settings",
  ]) {
    await expect(page.getByTestId(`app-nav-${destination}`)).toBeVisible();
  }
  // /workflows is a legacy subpath of the Automations nav item.
  await expect(page.getByTestId("app-nav-automations")).toHaveAttribute(
    "aria-current",
    "page"
  );

  const initialBox = await sidebar.boundingBox();
  expect(initialBox).not.toBeNull();
  expect(initialBox!.width).toBeGreaterThan(120);
  await expect(page.getByTestId("app-sidebar-toggle")).toHaveCount(0);

  const resizer = page.getByTestId("app-sidebar-resizer");
  await expect(resizer).toBeVisible();
  const widthBeforeKeyboardResize = (await sidebar.boundingBox())!.width;
  await resizer.press("ArrowRight");
  const widthAfterKeyboardResize = (await sidebar.boundingBox())!.width;
  expect(widthAfterKeyboardResize).toBe(widthBeforeKeyboardResize + 8);

  const resizerBox = await resizer.boundingBox();
  expect(resizerBox).not.toBeNull();
  await page.mouse.move(
    resizerBox!.x + resizerBox!.width / 2,
    resizerBox!.y + 80
  );
  await page.mouse.down();
  await page.mouse.move(56, resizerBox!.y + 80, { steps: 8 });
  await page.mouse.up();
  const widthAfterDrag = (await sidebar.boundingBox())!.width;
  expect(widthAfterDrag).toBe(64);
  await expect(sidebar).toHaveAttribute("data-compact", "true");
  await expect(page.getByTestId("app-nav-automations")).toHaveAttribute(
    "aria-label",
    "Automations"
  );
  for (const compactLabel of [
    ".app-sidebar-section-label",
    ".app-sidebar-link-label",
    ".app-sidebar-footer-label",
  ]) {
    await expect(sidebar.locator(compactLabel)).toHaveCount(0);
  }
  // The brand mark lives in the window chrome above the sidebar and stays
  // visible there when the sidebar is compact.
  const compactSidebarBox = await sidebar.boundingBox();
  const brandLink = page.locator(
    '.app-window-chrome a[aria-label="Mogplex home"]'
  );
  await expect(brandLink).toBeVisible();
  const brandLinkBox = await brandLink.boundingBox();
  expect(compactSidebarBox).not.toBeNull();
  expect(brandLinkBox).not.toBeNull();
  expect(brandLinkBox!.y + brandLinkBox!.height).toBeLessThanOrEqual(
    compactSidebarBox!.y
  );
});

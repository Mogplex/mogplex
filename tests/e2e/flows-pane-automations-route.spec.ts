import { expect, test } from "@playwright/test";
import { setupWorkflowsPage } from "./helpers/flows-pane-theme-fixtures";

test("the Automations route gives a new user a clear creation path", async ({
  page,
}) => {
  await setupWorkflowsPage(page, "dark", { flows: [] });

  await page.goto("/alex/automations");
  await page.waitForLoadState("networkidle");

  await expect(
    page.getByRole("heading", { name: "Automations" })
  ).toBeVisible();
  await expect(page.getByTestId("automations-empty-state")).toContainText(
    "Make repeat repository work automatic"
  );

  await page.getByTestId("automations-new").click();
  await expect(page.getByTestId("flow-template-picker")).toBeVisible();
  await expect(page.getByText("Start from a working graph")).toBeVisible();
});

test("the Automations toolbar opens the trigger setup controls", async ({
  page,
}) => {
  await setupWorkflowsPage(page, "dark");

  await page.goto("/alex/automations");
  await page.waitForLoadState("networkidle");

  const triggerSetup = page.getByTestId("flow-trigger-setup-button");
  await expect(triggerSetup).toBeEnabled();
  await triggerSetup.click();

  await expect(page.getByTestId("flows-inspector-header")).toContainText(
    "Entry point"
  );
  await expect(page.getByTestId("flow-trigger-event")).toBeVisible();
});

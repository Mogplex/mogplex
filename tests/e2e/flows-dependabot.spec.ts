import { expect, test } from "@playwright/test";
import { selectAppOption } from "./helpers/app-select";
import { stubFlowsPage } from "./helpers/flows-pane-keyboard-fixtures";

test("Dependabot lifecycle selections save and survive reload without re-enabling created", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const { getFlow } = await stubFlowsPage(page);
  await page.goto("/alex/workflows");
  await page
    .locator(".react-flow__node")
    .filter({ hasText: "PR opened" })
    .click();
  await selectAppOption(
    page.getByLabel("Event", { exact: true }),
    "dependabot_alert"
  );
  await expect(
    page.getByRole("checkbox", { name: "created", exact: true })
  ).toBeChecked();
  await page.getByRole("checkbox", { name: "fixed", exact: true }).check();
  await page.getByRole("checkbox", { name: "created", exact: true }).uncheck();
  await expect(page.getByTestId("flow-save-status")).toContainText("Saved");
  expect(
    getFlow().draft_graph.nodes.find((node) => node.type === "start")?.data
  ).toMatchObject({
    event: "dependabot_alert",
    dependabotAlertActions: ["fixed"],
  });
  await page.reload();
  await page
    .locator(".react-flow__node")
    .filter({ hasText: "Dependabot alert" })
    .click();
  await expect(
    page.getByRole("checkbox", { name: "fixed", exact: true })
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "created", exact: true })
  ).not.toBeChecked();
  await page.getByRole("checkbox", { name: "fixed", exact: true }).uncheck();
  await expect(page.getByTestId("flow-save-status")).toContainText("Saved");
  expect(
    getFlow().draft_graph.nodes.find((node) => node.type === "start")?.data
  ).toMatchObject({ dependabotAlertActions: [] });
  await page.screenshot({
    path: "test-results/dependabot-lifecycle-actions.png",
  });
  await page.reload();
  await page
    .locator(".react-flow__node")
    .filter({ hasText: "Dependabot alert" })
    .click();
  await expect(
    page.getByRole("checkbox", { name: "created", exact: true })
  ).not.toBeChecked();
  await selectAppOption(page.getByLabel("Event", { exact: true }), "pr_opened");
  await expect(
    page.getByText("Alert lifecycle actions", { exact: true })
  ).toHaveCount(0);
});

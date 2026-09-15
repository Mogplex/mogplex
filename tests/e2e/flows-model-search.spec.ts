import { expect, test } from "@playwright/test";
import {
  flowPayload,
  fulfillJson,
  LONG_MODEL_ID,
  setupWorkflowsPage,
} from "./helpers/flows-inspector-layout-fixtures";
import { capturePageErrors } from "./helpers/page-errors";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await setupWorkflowsPage(page);
  const models = [
    { id: LONG_MODEL_ID, provider: "minimax", name: "MiniMax M3" },
    { id: "openai/gpt-5.4", provider: "openai", name: "GPT-5.4" },
    {
      id: "meta/long-model-id",
      provider: "meta",
      name: "Muse Spark 1.3 Contributor Extended Context",
    },
  ].map((model) => ({
    ...model,
    context_length: 1000000,
    capabilities: ["text"],
    is_available: true,
    is_enabled: true,
  }));
  await page.route("**/api/models", (route) =>
    fulfillJson(route, { models, catalog: models })
  );
  let currentFlow = structuredClone(flowPayload);
  await page.route("**/api/flows/flow-1", async (route) => {
    if (route.request().method() === "PUT") {
      const payload = route.request().postDataJSON() as Partial<
        typeof currentFlow
      >;
      currentFlow = { ...currentFlow, ...payload };
    }
    await fulfillJson(route, currentFlow);
  });
  await page.goto("/alex/automations");
  await page.getByTestId("rf__node-agent-1").click();
  await expect(page.getByLabel("Model", { exact: true })).toBeVisible();
});

test("agent model settings lead the sidebar and return to the top on selection", async ({
  page,
}, testInfo) => {
  const model = page.getByLabel("Model", { exact: true });
  const description = page.getByPlaceholder(
    "Describe what this flow should accomplish."
  );
  await page.screenshot({
    path: testInfo.outputPath("inspector.png"),
    animations: "disabled",
  });
  const modelBox = (await model.boundingBox())!;
  const descriptionBox = (await description.boundingBox())!;
  const scrollBox = (await page
    .getByTestId("flows-inspector-scroll")
    .boundingBox())!;
  expect(modelBox.y).toBeLessThan(descriptionBox.y);
  expect(modelBox.y - scrollBox.y).toBeLessThan(120);
  await expect(model).toBeInViewport();
  await expect(
    page.getByLabel("Fallback model", { exact: true })
  ).toBeInViewport();

  await description.scrollIntoViewIfNeeded();
  await page.getByTestId("rf__node-start").click();
  await page.getByTestId("rf__node-agent-1").click();
  await expect(model).toBeInViewport();
  expect(
    await page
      .getByTestId("flows-inspector-scroll")
      .evaluate((el) => el.scrollTop)
  ).toBe(0);
});

test("model search filters by name, provider and ID and saves both choices", async ({
  page,
}, testInfo) => {
  const errors = capturePageErrors(page);
  const model = page.getByLabel("Model", { exact: true });
  await expect(model).toHaveAccessibleDescription(/MiniMax M3/);
  await model.click();
  const search = page.getByPlaceholder("Search models...");
  await expect(search).toBeFocused();
  await search.fill("NO-SUCH-MODEL");
  await expect(page.getByText("No models found.")).toBeVisible();
  await expect(page.getByRole("option")).toHaveCount(0);
  await search.fill("  GPT-5.4  ");
  await expect(page.getByRole("option")).toHaveCount(1);
  await search.press("ArrowDown");
  await search.press("Enter");
  await expect(model).toHaveAttribute("data-value", "openai/gpt-5.4");
  await expect(model).toHaveAccessibleDescription(/GPT-5.4/);
  await expect(model).toBeFocused();

  const fallback = page.getByLabel("Fallback model", { exact: true });
  await fallback.click();
  await expect(search).toHaveValue("");
  await search.fill("META");
  await expect(page.getByRole("option")).toHaveCount(1);
  await search.fill("meta/long-model-id");
  await expect(page.getByRole("option")).toHaveCount(1);
  await page.screenshot({
    path: testInfo.outputPath("model-search.png"),
    animations: "disabled",
  });
  await page.getByRole("option").click();
  await expect(fallback).toHaveAttribute("data-value", "meta/long-model-id");
  await expect(fallback).toBeFocused();
  await fallback.click();
  await search.fill("minimax");
  await search.press("Escape");
  await expect(fallback).toBeFocused();
  await expect(fallback).toHaveAttribute("data-value", "meta/long-model-id");

  await expect(page.getByTestId("flow-save-status")).toHaveText("Saved");
  await page.reload();
  await page.getByTestId("rf__node-agent-1").click();
  await expect(model).toHaveAttribute("data-value", "openai/gpt-5.4");
  await expect(fallback).toHaveAttribute("data-value", "meta/long-model-id");

  await fallback.click();
  await search.fill("Default fallback pool");
  await page.getByRole("option", { name: "Default fallback pool" }).click();
  await expect(fallback).toHaveAttribute("data-value", "");
  await expect(page.getByTestId("flow-save-status")).toHaveText("Saved");
  await page.reload();
  await page.getByTestId("rf__node-agent-1").click();
  await expect(fallback).toHaveAttribute("data-value", "");
  expect(errors).toEqual([]);
});

test("model search fits a narrow inspector and keeps long names readable", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const model = page.getByLabel("Model", { exact: true });
  await model.click();
  const search = page.getByPlaceholder("Search models...");
  await search.fill("Muse Spark");
  const option = page.getByRole("option");
  await expect(option).toBeVisible();
  const optionBox = (await option.boundingBox())!;
  expect(optionBox.x).toBeGreaterThanOrEqual(0);
  expect(optionBox.x + optionBox.width).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: testInfo.outputPath("mobile-model-search.png"),
    animations: "disabled",
  });
  await option.click();
  await expect(model).toContainText(
    "Muse Spark 1.3 Contributor Extended Context"
  );
  const label = model.locator("span").first();
  expect(await label.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true
  );
  await page.screenshot({
    path: testInfo.outputPath("mobile-model-selected.png"),
    animations: "disabled",
  });
});

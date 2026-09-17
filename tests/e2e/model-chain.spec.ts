import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import { mockSettingsPageData, model } from "./helpers/theme-settings-fixtures";

test("chain edits share catalog state, save atomically, and fit desktop and mobile", async ({
  page,
}, testInfo) => {
  await enableScopedE2EAuth(page);
  await mockSettingsPageData(page);
  await page.route(/\/api\/settings(?:\?.*)?$/, (route) =>
    route.fulfill({ json: { default_model: model.id, theme: "dark" } })
  );
  const alternatives = ["One", "Two", "Three", "Four", "Five"].map((name) => ({
    ...model,
    id: `openai/${name.toLowerCase()}`,
    name,
  }));
  const catalog = [
    model,
    ...alternatives,
    {
      ...model,
      id: "openai/disabled",
      name: "Disabled model",
      is_enabled: false,
    },
  ];
  let saved = { primary: model.id, fallbacks: ["openai/one", "openai/two"] };
  let writes = 0;
  let failSave = true;
  let failLoad = true;
  await page.route("**/api/models", async (route) => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON();
      catalog.find((item) => item.id === body.model_id)!.is_enabled =
        body.is_enabled;
    }
    await route.fulfill({
      json: { models: catalog.filter((item) => item.is_enabled), catalog },
    });
  });
  await page.route("**/api/settings/model-chain", async (route) => {
    if (route.request().method() === "GET" && failLoad)
      return route.fulfill({
        status: 500,
        json: { error: "Unable to load model chain" },
      });
    if (route.request().method() === "PATCH") {
      writes++;
      if (failSave)
        return route.fulfill({
          status: 500,
          json: {
            error: "Unable to save model chain. No changes were applied.",
          },
        });
      saved = route.request().postDataJSON();
    }
    await route.fulfill({ json: saved });
  });
  await page.setViewportSize({ width: 2560, height: 1440 });
  await page.goto(scopedPath("/settings?tab=models"));
  const section = page.getByRole("region", { name: "Default and fallbacks" });
  await expect(section.getByRole("alert")).toContainText(
    "Unable to load model chain"
  );
  failLoad = false;
  await section.getByRole("button", { name: "Retry", exact: true }).click();
  const primary = section.getByRole("button", { name: "Primary", exact: true });
  await expect(primary).toContainText(model.name);
  await expect(
    section.getByRole("button", { name: "Save chain" })
  ).toBeDisabled();
  expect((await section.boundingBox())!.width).toBeLessThanOrEqual(760);
  expect(
    (await page.getByTestId("models-content").boundingBox())!.width
  ).toBeLessThanOrEqual(1440);
  const first = section.getByRole("button", {
    name: "Fallback 1",
    exact: true,
  });
  const move = section.getByRole("button", { name: "Move fallback 1 down" });
  expect(
    (await move.boundingBox())!.x -
      ((await first.boundingBox())!.x + (await first.boundingBox())!.width)
  ).toBeLessThan(50);
  await page.screenshot({
    path: testInfo.outputPath("model-chain-desktop.png"),
  });
  await primary.click();
  await expect(
    page.getByRole("option", { name: /Disabled model/ })
  ).toHaveCount(0);
  await page.getByPlaceholder("Search enabled models...").fill("Five");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(primary).toContainText("Five");
  expect(writes).toBe(0);
  await section.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(primary).toContainText(model.name);
  await primary.click();
  await page
    .getByRole("dialog", { name: "Primary options", exact: true })
    .getByRole("option", { name: "One", exact: true })
    .click();
  await expect(primary).toContainText("One");
  await expect(first).toContainText("Two");
  await section.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(first).toContainText("One");
  await primary.click();
  await page.keyboard.press("Escape");
  await expect(primary).toBeFocused();
  expect(
    await primary.evaluate((element) => getComputedStyle(element).boxShadow)
  ).not.toBe("none");
  await page.getByTestId("models-set-default-openai/five").click();
  await expect(primary).toContainText("Five");
  await expect(page.getByTestId("models-set-default-openai/five")).toHaveCount(
    0
  );
  await page.getByTestId("models-add-fallback-openai/three").click();
  await section
    .getByRole("button", { name: "Add a fallback", exact: true })
    .click();
  await page.getByRole("option", { name: "Four", exact: true }).click();
  await expect(section.getByText("4/4", { exact: true })).toBeVisible();
  await expect(
    section.getByRole("button", { name: "Add a fallback", exact: true })
  ).toBeDisabled();
  await section.getByRole("button", { name: "Move fallback 1 down" }).click();
  await expect(first).toContainText("Two");
  await section.getByRole("button", { name: "Move fallback 2 up" }).click();
  await expect(first).toContainText("One");
  await first.click();
  await page
    .getByRole("dialog", { name: "Fallback 1 options", exact: true })
    .getByRole("option", { name: model.name, exact: true })
    .click();
  await expect(first).toContainText(model.name);
  await first.click();
  await page
    .getByRole("dialog", { name: "Fallback 1 options", exact: true })
    .getByRole("option", { name: "One", exact: true })
    .click();
  await expect(first).toContainText("One");
  await section.getByRole("button", { name: "Save chain" }).click();
  await expect(section.getByRole("status")).toContainText("Unable to save");
  expect(saved.primary).toBe(model.id);
  await expect(primary).toContainText("Five");
  failSave = false;
  await section.getByRole("button", { name: "Save chain" }).click();
  await expect(section.getByRole("status")).toHaveText("Chain saved.");
  expect(saved).toEqual({
    primary: "openai/five",
    fallbacks: ["openai/one", "openai/two", "openai/three", "openai/four"],
  });
  await page.reload();
  await expect(primary).toContainText("Five");
  await page.getByTestId("models-toggle-openai/five").click();
  await expect(
    section.getByText("Disabled in catalog", { exact: true })
  ).toBeVisible();
  await page.getByTestId("models-toggle-openai/one").click();
  await expect(
    section.getByText("Disabled in catalog", { exact: true })
  ).toHaveCount(2);
  await first.click();
  await expect(
    page.getByRole("option", { name: "One", exact: true })
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByPlaceholder("Search enabled models...")).toHaveCount(
    0
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("model-chain-mobile.png"),
  });
  await page.getByTestId("models-toggle-openai/five").click();
  for (let index = 0; index < 4; index++)
    await section
      .getByRole("button", { name: "Remove fallback 1", exact: true })
      .click();
  await section.getByRole("button", { name: "Save chain" }).click();
  await expect(section.getByRole("status")).toHaveText("Chain saved.");
  expect(saved.fallbacks).toEqual([]);
});

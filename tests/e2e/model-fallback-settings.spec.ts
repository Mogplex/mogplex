import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import { mockSettingsPageData, model } from "./helpers/theme-settings-fixtures";

test("default and fallback settings share a compact row above the catalog", async ({
  page,
}, testInfo) => {
  await enableScopedE2EAuth(page);
  await mockSettingsPageData(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.route(/\/api\/settings(?:\?.*)?$/, (route) =>
    route.fulfill({ json: { default_model: model.id, theme: "dark" } })
  );
  const alternative = {
    ...model,
    id: "moonshotai/kimi-k3-fast",
    name: "Kimi K3 Fast",
    provider: "moonshotai",
  };
  await page.route("**/api/models", (route) =>
    route.fulfill({
      json: { models: [model, alternative], catalog: [model, alternative] },
    })
  );
  await page.route("**/api/settings/model-fallbacks", (route) =>
    route.fulfill({ json: { fallback_model_ids: [alternative.id] } })
  );
  await page.goto(scopedPath("/settings?tab=models"));
  const defaults = page.getByTestId("models-default-summary");
  const fallbacks = page.getByRole("region", { name: "Fallback models" });
  await expect(
    fallbacks.getByRole("button", { name: "Fallback 1", exact: true })
  ).toBeVisible();
  const primary = await defaults.boundingBox();
  const fallback = await fallbacks.boundingBox();
  expect(primary).not.toBeNull();
  expect(fallback).not.toBeNull();
  expect(Math.abs(primary!.y - fallback!.y)).toBeLessThan(4);
  expect(primary!.x + primary!.width).toBeLessThan(fallback!.x);
  await page.screenshot({
    path: testInfo.outputPath("model-settings-desktop.png"),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const mobilePrimary = await defaults.boundingBox();
  const mobileFallback = await fallbacks.boundingBox();
  expect(mobilePrimary!.y + mobilePrimary!.height).toBeLessThan(
    mobileFallback!.y
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("model-settings-mobile.png"),
  });
});

test("four fallback choices hide the add control until a choice is removed", async ({
  page,
}, testInfo) => {
  await enableScopedE2EAuth(page);
  await mockSettingsPageData(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const alternatives = ["One", "Two", "Three", "Four", "Five"].map((name) => ({
    ...model,
    id: `openai/${name.toLowerCase()}`,
    name,
  }));
  let saved = alternatives.slice(0, 4).map((item) => item.id);
  await page.route("**/api/models", (route) =>
    route.fulfill({
      json: {
        models: [model, ...alternatives],
        catalog: [model, ...alternatives],
      },
    })
  );
  await page.route("**/api/settings/model-fallbacks", async (route) => {
    if (route.request().method() === "PATCH")
      saved = route.request().postDataJSON().fallback_model_ids;
    await route.fulfill({ json: { fallback_model_ids: saved } });
  });
  await page.goto(scopedPath("/settings?tab=models"));
  const section = page.getByRole("region", { name: "Fallback models" });
  await expect(
    section.getByRole("button", { name: "Fallback 4", exact: true })
  ).toBeVisible();
  await expect(
    section.getByRole("button", { name: "Add fallback model", exact: true })
  ).toHaveCount(0);
  await section
    .getByRole("button", { name: "Remove fallback 4", exact: true })
    .click();
  await section
    .getByRole("button", { name: "Add fallback model", exact: true })
    .click();
  await page
    .getByRole("option", { name: "Five · openai", exact: true })
    .click();
  await expect(
    section.getByRole("button", { name: "Add fallback model", exact: true })
  ).toHaveCount(0);
  await section.getByRole("button", { name: "Save fallbacks" }).click();
  await expect(section.getByRole("status")).toHaveText(
    "Fallback models saved."
  );
  expect(saved).toEqual([
    "openai/one",
    "openai/two",
    "openai/three",
    "openai/five",
  ]);
  await page.reload();
  await expect(
    section.getByRole("button", { name: "Fallback 4", exact: true })
  ).toContainText("Five");
  await section.screenshot({
    path: testInfo.outputPath("four-fallbacks-mobile.png"),
  });
});

test("fallback choices preserve order and draft on failure, reload, and can be turned off", async ({
  page,
}, testInfo) => {
  await enableScopedE2EAuth(page);
  await mockSettingsPageData(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const alternatives = ["Second", "Third", "Fourth"].map((name) => ({
    ...model,
    id: `openai/${name.toLowerCase()}`,
    name,
  }));
  await page.route("**/api/models", (route) =>
    route.fulfill({
      json: {
        models: [model, ...alternatives],
        catalog: [model, ...alternatives],
      },
    })
  );
  let saved: string[] | null = null;
  let failLoad = true;
  let failSave = true;
  await page.route("**/api/settings/model-fallbacks", async (route) => {
    if (route.request().method() === "GET" && failLoad)
      return route.fulfill({
        status: 500,
        json: { error: "Unable to load fallback models" },
      });
    if (route.request().method() === "PATCH") {
      if (failSave)
        return route.fulfill({
          status: 500,
          json: { error: "Unable to save fallback models" },
        });
      saved = route.request().postDataJSON().fallback_model_ids;
    }
    await route.fulfill({ json: { fallback_model_ids: saved } });
  });
  await page.goto(scopedPath("/settings?tab=models"));
  const section = page.getByRole("region", { name: "Fallback models" });
  await expect(section.getByRole("alert")).toContainText(
    "Unable to load fallback models"
  );
  failLoad = false;
  await section.getByRole("button", { name: "Retry", exact: true }).click();
  await section
    .getByRole("button", { name: "Add fallback model", exact: true })
    .click();
  await page
    .getByRole("option", { name: "Second · openai", exact: true })
    .click();
  await section
    .getByRole("button", { name: "Add fallback model", exact: true })
    .click();
  await page
    .getByRole("option", { name: "Third · openai", exact: true })
    .click();
  await section.getByRole("button", { name: "Move fallback 2 up" }).click();
  await section.getByRole("button", { name: "Save fallbacks" }).click();
  await expect(section.getByRole("alert")).toContainText("Unable to save");
  await expect(
    section.getByRole("button", { name: "Fallback 1", exact: true })
  ).toContainText("Third");
  expect(saved).toBeNull();
  failSave = false;
  await section.getByRole("button", { name: "Save fallbacks" }).click();
  await expect(section.getByRole("status")).toHaveText(
    "Fallback models saved."
  );
  expect(saved).toEqual(["openai/third", "openai/second"]);
  await page.reload();
  await expect(
    section.getByRole("button", { name: "Fallback 1", exact: true })
  ).toContainText("Third");
  await section.screenshot({
    path: testInfo.outputPath("fallback-models-mobile.png"),
  });
  await section
    .getByRole("button", { name: "Remove fallback 1", exact: true })
    .click();
  await section
    .getByRole("button", { name: "Remove fallback 1", exact: true })
    .click();
  await section.getByRole("button", { name: "Save fallbacks" }).click();
  await expect(section.getByRole("status")).toHaveText(
    "Fallback models saved."
  );
  expect(saved).toEqual([]);
});

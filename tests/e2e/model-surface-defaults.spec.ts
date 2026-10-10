import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import { mockSettingsPageData, model } from "./helpers/theme-settings-fixtures";

for (const width of [1280, 390]) {
  test(`surface overrides are visible, can follow primary, and retain saved state on failure (${width}px)`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await enableScopedE2EAuth(page);
    await mockSettingsPageData(page);
    const override = {
      ...model,
      id: "openai/override",
      name: "Saved override",
    };
    await page.route("**/api/models", (route) =>
      route.fulfill({
        json: { models: [model, override], catalog: [model, override] },
      })
    );
    await page.route("**/api/settings/model-chain", (route) =>
      route.fulfill({ json: { primary: model.id, fallbacks: [] } })
    );
    let saved = { id: "chat", model: override.id, followsPrimary: false };
    let failSave = false;
    await page.route("**/api/settings/model-targets", async (route) => {
      if (route.request().method() === "PATCH") {
        if (failSave)
          return route.fulfill({
            status: 500,
            json: {
              error: "Unable to save surface model. No changes were applied.",
            },
          });
        const body = route.request().postDataJSON();
        expect(body).toEqual({ surface: "chat", model: null });
        saved = { id: "chat", model: model.id, followsPrimary: true };
        return route.fulfill({ json: saved });
      }
      return route.fulfill({
        json: {
          surfaces: [
            saved,
            ...["slack", "cli", "control", "agents"].map((id) => ({
              id,
              model: override.id,
              followsPrimary: false,
            })),
          ],
          automations: [],
        },
      });
    });
    await page.goto(scopedPath("/models/configuration"));
    const section = page.getByRole("region", { name: "Defaults by surface" });
    const picker = section.getByRole("button", {
      name: "Web chat model",
      exact: true,
    });
    await expect(picker).toContainText("Saved override");
    await picker.click();
    await page
      .getByRole("option", { name: "Follow primary", exact: true })
      .click();
    await expect(picker).toContainText("Follow primary");
    await expect(
      page.getByRole("dialog", { name: "Web chat model options", exact: true })
    ).toBeHidden();
    await expect(section.getByRole("status")).toContainText("Web chat saved.");
    await page.reload();
    await expect(picker).toContainText("Follow primary");
    failSave = true;
    await picker.click();
    await page
      .getByRole("option", { name: "Saved override", exact: true })
      .click();
    await expect(section.getByRole("alert")).toContainText(
      "Unable to save surface model"
    );
    await expect(
      page.getByRole("dialog", { name: "Web chat model options", exact: true })
    ).toBeHidden();
    await expect(picker).toContainText("Follow primary");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true);
    await section.scrollIntoViewIfNeeded();
    await section.screenshot({
      path: testInfo.outputPath(`surface-defaults-${width}.png`),
    });
  });
}

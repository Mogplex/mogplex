import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  mockSettingsPageData,
  model,
  fulfillJson,
} from "./helpers/theme-settings-fixtures";
import { MODEL_SURFACES } from "../../lib/models/surface-defaults";

test("model destinations recover from load and save failures, preserve choices, and persist after reload", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockSettingsPageData(page);
  await page.setViewportSize({ width: 390, height: 844 });
  let storedDefault = "openai/previous";
  let loadFails = true;
  let saveFails = true;
  const writes: unknown[] = [];
  await page.route("**/api/settings/model-targets", (route) =>
    loadFails
      ? fulfillJson(route, { error: "unavailable" }, 500)
      : fulfillJson(route, {
          surfaces: MODEL_SURFACES.map((id) => ({ id, model: storedDefault })),
          automations: [],
        })
  );
  await page.route(/\/api\/settings(?:\?.*)?$/, async (route) => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON() as { default_model: string };
      if (saveFails)
        return fulfillJson(
          route,
          { error: "Unable to save model settings. No changes were applied." },
          500
        );
      writes.push(body);
      storedDefault = body.default_model;
      return fulfillJson(route, { ok: true });
    }
    return fulfillJson(route, { default_model: storedDefault, theme: "light" });
  });
  await page.goto(scopedPath("/settings?tab=models"));
  await page.getByTestId(`models-set-default-${model.id}`).click();
  const dialog = page.getByTestId("models-default-dialog");
  await expect(dialog.getByRole("alert")).toContainText(
    "Unable to load destinations"
  );
  await expect(page.getByTestId("models-default-confirm")).toBeDisabled();
  loadFails = false;
  await dialog.getByRole("button", { name: "Retry" }).click();
  await expect(dialog.getByText("No automations yet.")).toBeVisible();
  await expect(dialog.getByRole("switch")).toHaveCount(5);
  await page.getByRole("switch", { name: "Web chat", exact: true }).click();
  await page.getByRole("switch", { name: "Control", exact: true }).click();
  await page
    .getByRole("switch", { name: "Agent presets and API / MCP", exact: true })
    .click();
  await dialog.screenshot({ path: "test-results/default-model-mobile.png" });
  await page.getByTestId("models-default-confirm").click();
  await expect(dialog.getByRole("alert")).toContainText(
    "No changes were applied"
  );
  await expect(
    page.getByRole("switch", { name: "Control", exact: true })
  ).toBeChecked();
  expect(writes).toEqual([]);
  saveFails = false;
  await page.getByTestId("models-default-confirm").click();
  await expect(dialog).toHaveCount(0);
  expect(writes).toEqual([
    {
      default_model: model.id,
      apply_to_surfaces: ["chat", "control", "agents"],
      automation_ids: [],
    },
  ]);
  await page.reload();
  await expect(
    page.getByTestId(`models-set-default-${model.id}`)
  ).toContainText("Selected");
});

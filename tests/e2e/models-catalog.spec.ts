import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import { linkedVercelCapability } from "./helpers/activation-fixtures";
import type { Route } from "@playwright/test";

const recommendedAt = new Date().toISOString();

const connectedUser = {
  id: "user-1",
  email: "alex@example.com",
  username: "alex",
  name: "Alex",
  avatar_url: "https://example.com/avatar.png",
  github_connected: true,
  github_app_connected: false,
  github_app_available: false,
  github_connection_mode: "oauth" as const,
  vercel: linkedVercelCapability,
};

const catalog = [
  {
    id: "minimax/minimax-m2.7",
    provider: "minimax",
    name: "Minimax M2.7",
    context_length: 205000,
    pricing_input: 0.0000025,
    pricing_output: 0.00001,
    capabilities: ["vision", "tool-calling"],
    is_available: true,
    is_recommended: true,
    recommendation_bucket: "open",
    recommendation_rank: 1,
    recommendation_reason: "open_best_general",
    recommended_at: recommendedAt,
    is_enabled: true,
  },
  {
    id: "openai/gpt-oss-120b",
    provider: "openai",
    name: "GPT-OSS 120B",
    context_length: 128000,
    pricing_input: 0.00000015,
    pricing_output: 0.0000006,
    capabilities: ["tool-calling"],
    is_available: true,
    is_recommended: true,
    recommendation_bucket: "open",
    recommendation_rank: 2,
    recommendation_reason: "open_best_economy",
    recommended_at: recommendedAt,
    is_enabled: false,
  },
  {
    id: "openai/gpt-5.4",
    provider: "openai",
    name: "GPT-5.4",
    context_length: 1100000,
    pricing_input: 0.000015,
    pricing_output: 0.000075,
    capabilities: ["reasoning"],
    is_available: true,
    is_recommended: false,
    recommendation_bucket: null,
    recommendation_rank: null,
    recommendation_reason: null,
    recommended_at: null,
    is_enabled: false,
  },
  {
    id: "anthropic/claude-sonnet-4.6",
    provider: "anthropic",
    name: "Claude Sonnet 4.6",
    context_length: 1000000,
    pricing_input: 0.000003,
    pricing_output: 0.000015,
    capabilities: ["reasoning"],
    is_available: true,
    is_recommended: true,
    recommendation_bucket: "frontier",
    recommendation_rank: 1,
    recommendation_reason: "frontier_latest_general",
    recommended_at: recommendedAt,
    is_enabled: false,
  },
  {
    id: "anthropic/claude-opus-4.7",
    provider: "anthropic",
    name: "Claude Opus 4.7",
    context_length: 1000000,
    pricing_input: 0.000005,
    pricing_output: 0.000025,
    capabilities: ["reasoning"],
    is_available: false,
    is_recommended: false,
    recommendation_bucket: null,
    recommendation_rank: null,
    recommendation_reason: null,
    recommended_at: null,
    is_enabled: false,
    is_hidden: true,
  },
];

async function fulfillJson(route: Route, data: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(data),
  });
}

test("models catalog supports provider, state, pricing filters, and state sorting", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  let defaultModel = "minimax/minimax-m2.7";
  const catalogState = catalog.map((model) => ({ ...model }));

  await page.route("**/api/auth/user", (route) =>
    fulfillJson(route, { user: connectedUser })
  );
  await page.route(/\/api\/settings(?:\?.*)?$/, async (route) => {
    if (route.request().method() === "PATCH") {
      const payload = JSON.parse(route.request().postData() || "{}") as {
        default_model?: string;
      };
      if (payload.default_model) {
        defaultModel = payload.default_model;
      }
      await fulfillJson(route, { ok: true });
      return;
    }

    await fulfillJson(route, { default_model: defaultModel, theme: "dark" });
  });
  await page.route("**/api/models", async (route) => {
    if (route.request().method() === "PATCH") {
      const payload = JSON.parse(route.request().postData() || "{}") as {
        model_id?: string;
        is_enabled?: boolean;
      };
      if (payload.model_id && typeof payload.is_enabled === "boolean") {
        const model = catalogState.find(
          (entry) => entry.id === payload.model_id
        );
        if (model) {
          model.is_enabled = payload.is_enabled;
        }
      }
      await fulfillJson(route, { ok: true });
      return;
    }

    await fulfillJson(route, {
      models: catalogState.filter((model) => model.is_enabled),
      catalog: catalogState,
    });
  });
  await page.route("**/api/github/installations", (route) =>
    fulfillJson(route, [])
  );
  await page.route("**/api/connections", (route) =>
    fulfillJson(route, { connections: [] })
  );
  await page.route("**/api/models/provider-icons", (route) =>
    fulfillJson(route, { providers: ["anthropic", "minimax", "openai"] })
  );
  // Serve the icon bytes too: the src points at storage that does not exist
  // in CI, and a failed load makes ProviderIcon swap the <img> for the
  // letter fallback before the src assertion runs.
  await page.route(
    /\/storage\/v1\/object\/public\/provider-icons\/.*\.png$/,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "image/png",
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
          "base64"
        ),
      })
  );

  await page.goto(scopedPath("settings?tab=models"));
  await page.waitForLoadState("networkidle");

  await expect(page.getByTestId("models-default-summary")).toContainText(
    "minimax-m2.7"
  );
  await expect(
    page.getByTestId("models-set-default-minimax/minimax-m2.7")
  ).toContainText("Selected");
  await expect(
    page.getByTestId("models-recommendation-freshness")
  ).toContainText("Recommendations refreshed");

  // Hidden models stay in the API catalog payload but are excluded from the
  // preferences table.
  await expect(
    page.getByTestId("models-recommendation-freshness")
  ).toContainText("Showing 4 of 4 models");
  await expect(page.getByText("Claude Opus 4.7")).toHaveCount(0);
  const minimaxProviderIcon = page.getByTestId(
    "models-provider-icon-minimax/minimax-m2.7"
  );
  await expect(minimaxProviderIcon).toBeVisible();
  await expect(minimaxProviderIcon.locator("img")).toHaveAttribute(
    "src",
    /\/storage\/v1\/object\/public\/provider-icons\/minimax\.png$/
  );

  await expect(
    page.getByTestId("models-set-default-openai/gpt-oss-120b")
  ).toBeDisabled();
  await page.getByTestId("models-toggle-openai/gpt-oss-120b").click();
  await page.getByTestId("models-set-default-openai/gpt-oss-120b").click();
  await expect(page.getByTestId("models-default-summary")).toContainText(
    "gpt-oss-120b"
  );
  await expect(
    page.getByTestId("models-set-default-openai/gpt-oss-120b")
  ).toContainText("Selected");
  expect(defaultModel).toBe("openai/gpt-oss-120b");

  await expect(page.getByText("In $2.50")).toBeVisible();
  await expect(page.getByText("Out $75")).toBeVisible();

  await page.getByTestId("models-provider-filter").selectOption("openai");
  let visibleNames = await page
    .getByTestId("models-row-name")
    .allTextContents();
  expect(visibleNames).toEqual(["GPT-OSS 120B", "GPT-5.4"]);

  await page.getByTestId("models-enabled-filter").selectOption("enabled");
  const providerFilteredNames = await page
    .getByTestId("models-row-name")
    .allTextContents();
  expect(providerFilteredNames).toEqual(["GPT-OSS 120B"]);

  await page.getByTestId("models-enabled-filter").selectOption("default");
  const defaultFilteredNames = await page
    .getByTestId("models-row-name")
    .allTextContents();
  expect(defaultFilteredNames).toEqual(["GPT-OSS 120B"]);

  await page.getByTestId("models-enabled-filter").selectOption("all");
  await page.getByTestId("models-provider-filter").selectOption("all");
  await page.getByTestId("models-sort-key").selectOption("state");
  const stateSortedNames = await page
    .getByTestId("models-row-name")
    .allTextContents();
  expect(stateSortedNames.slice(0, 2)).toEqual([
    "GPT-OSS 120B",
    "Minimax M2.7",
  ]);

  await page.getByTestId("models-sort-key").selectOption("pricing_input");
  const sortedNames = await page
    .getByTestId("models-row-name")
    .allTextContents();
  expect(sortedNames[0]).toBe("GPT-5.4");

  await page.getByTestId("models-search").fill("mini");
  visibleNames = await page.getByTestId("models-row-name").allTextContents();
  expect(visibleNames).toEqual(["Minimax M2.7"]);
});

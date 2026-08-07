import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  fulfillJson,
  mockBaseChrome,
  modelId,
} from "./helpers/automation-control-plane-fixtures";

const shortModel = modelId.split("/").pop()!;

test("control composers expose permissions, model, and MCP controls without a spend cap", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockBaseChrome(page);

  // Registered after mockBaseChrome so it wins: the composer's model chip
  // must follow the account default from /api/models.
  await page.route("**/api/models", (route) =>
    fulfillJson(route, {
      models: [
        { id: modelId, context_length: 128000 },
        { id: "anthropic/claude-sonnet-5", context_length: 200000 },
      ],
      catalog: [
        { id: modelId, context_length: 128000, is_enabled: true },
        {
          id: "anthropic/claude-sonnet-5",
          context_length: 200000,
          is_enabled: true,
        },
      ],
      default_model: modelId,
    })
  );
  await page.route("**/api/connections", (route) =>
    fulfillJson(route, { connections: [] })
  );
  const chatRequests: Array<{ model?: string }> = [];
  await page.route("**/api/control/chat", (route) => {
    chatRequests.push(route.request().postDataJSON() as { model?: string });
    return route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: "data: [DONE]\n\n",
    });
  });

  await page.goto(scopedPath("control"));
  await page.waitForLoadState("networkidle");

  // New-mission composer: permissions defaults to Skip Permissions, cycles to
  // Approve Edits, and no dollar spend-cap chip exists anywhere.
  await expect(page.getByText("Describe the outcome")).toBeVisible();
  const permissionsChip = page.getByRole("button", {
    name: "Skip Permissions",
  });
  await expect(permissionsChip).toBeVisible();
  await expect(page.getByText(/\$\d+ cap/)).toHaveCount(0);
  await permissionsChip.click();
  await expect(
    page.getByRole("button", { name: "Approve Edits" })
  ).toBeVisible();
  await page.getByRole("button", { name: "Approve Edits" }).click();
  await expect(
    page.getByRole("button", { name: "Skip Permissions" })
  ).toBeVisible();

  await page
    .getByPlaceholder("Describe what you want to achieve...")
    .fill("Ship the new onboarding flow");
  await page.getByRole("button", { name: "Start mission" }).click();

  // Dispatch reflects permissions and carries no budget line.
  await expect(
    page.getByText("Mogplex is planning. Permissions: Skip Permissions.")
  ).toBeVisible();
  await expect(page.getByText(/Budget: \$/)).toHaveCount(0);

  // Conversation composer: permissions chip, model chip preset to the account
  // default, and the MCP connections button are all present.
  const composerPermissions = page.getByRole("button", {
    name: "Skip Permissions",
  });
  await expect(composerPermissions).toBeVisible();
  const modelChip = page.getByRole("button", { name: shortModel, exact: true });
  await expect(modelChip).toBeVisible();
  const mcpButton = page.getByRole("button", { name: "Tools: 0" });
  await expect(mcpButton).toBeVisible();
  await mcpButton.click();
  await expect(page.getByRole("dialog", { name: "MCP servers" })).toBeVisible();
  await page.keyboard.press("Escape");

  // Switching models routes the chosen id through to the chat request body.
  await modelChip.click();
  await page.getByRole("button", { name: "anthropic/claude-sonnet-5" }).click();
  await page
    .getByPlaceholder("Direct Mogplex - it will delegate to agents")
    .fill("Summarize progress");
  await page.keyboard.press("Enter");

  await expect(
    page.getByText(
      /Scope: IMPLEMENT · target: mission · Skip Permissions · anthropic\/claude-sonnet-5\./
    )
  ).toBeVisible();
  await expect
    .poll(() => chatRequests.at(-1)?.model, { timeout: 10_000 })
    .toBe("anthropic/claude-sonnet-5");
});

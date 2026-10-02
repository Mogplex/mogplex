import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  fulfillJson,
  mockBaseChrome,
  mockControlSessionBootstrap,
} from "./helpers/automation-control-plane-fixtures";

test("Approve Edits explains Codex delivery restrictions in both composers", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockBaseChrome(page);
  await mockControlSessionBootstrap(page);
  await page.route("**/api/connections", (route) =>
    fulfillJson(route, { connections: [] })
  );
  await page.route("**/api/control/chat", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      headers: { "x-vercel-ai-ui-message-stream": "v1" },
      body: 'data: {"type":"start","messageId":"fixture-answer"}\n\ndata: {"type":"finish"}\n\ndata: [DONE]\n\n',
    })
  );
  await page.goto(scopedPath("/control"));
  const warning = page.getByText(
    "Codex workers cannot commit in this mode. Choose Skip Permissions to let them deliver."
  );
  await expect(warning).toHaveCount(0);
  await page.getByRole("button", { name: "Skip Permissions" }).click();
  await expect(warning).toBeVisible();
  await page
    .getByPlaceholder("Ask anything or run a command...")
    .fill("Check delivery permissions");
  await expect(
    page.getByRole("button", { name: "Start mission" })
  ).toBeEnabled();
  await page.getByRole("button", { name: "Start mission" }).click();
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
  await page.getByRole("button", { name: "Skip Permissions" }).click();
  await expect(warning).toBeVisible();
  await page.getByRole("button", { name: "Approve Edits" }).click();
  await expect(warning).toHaveCount(0);
});

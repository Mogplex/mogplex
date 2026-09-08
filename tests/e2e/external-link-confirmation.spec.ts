import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  fulfillJson,
  mockBaseChrome,
  mockControlSessionBootstrap,
} from "./helpers/automation-control-plane-fixtures";

const firstUrl = "https://github.com/webrenew/thinking-company-template/pull/7";
const secondUrl = "https://example.com/docs";

test.beforeEach(async ({ page, context }) => {
  await enableScopedE2EAuth(page);
  await mockBaseChrome(page);
  await mockControlSessionBootstrap(page);
  await page.route("**/api/integrations/slack/installations", (route) =>
    fulfillJson(route, { installations: [] })
  );
  await page.route("**/api/connections", (route) =>
    fulfillJson(route, { connections: [] })
  );
  const session = {
    id: "session-link-confirmation",
    title: "External links",
    messages: [
      {
        id: "reply-links",
        role: "assistant",
        parts: [
          {
            type: "text",
            text: `[Review PR](${firstUrl}) and [Read docs](${secondUrl})`,
          },
        ],
      },
    ],
  };
  await page.route("**/api/control/sessions**", (route) =>
    fulfillJson(
      route,
      new URL(route.request().url()).searchParams.has("id")
        ? session
        : [session]
    )
  );
  await context.route("https://github.com/**", (route) =>
    route.fulfill({ body: "Pull request" })
  );
  await context.route("https://example.com/**", (route) =>
    route.fulfill({ body: "Docs" })
  );
  await page.goto(scopedPath(`control?mission=${session.id}`));
});

test("external links ask by default and closing does not save the checkbox", async ({
  page,
}, testInfo) => {
  await page.getByRole("button", { name: "Review PR", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Open external link?" });
  await expect(dialog).toContainText(firstUrl);
  const checkbox = dialog.getByRole("checkbox", {
    name: "Don't show this again",
  });
  await expect(checkbox).not.toBeChecked();
  await dialog.screenshot({
    path: testInfo.outputPath("external-link-dialog.png"),
  });
  await checkbox.check();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Review PR", exact: true }).click();
  await expect(checkbox).not.toBeChecked();
  const popupPromise = page.waitForEvent("popup");
  await dialog.getByRole("button", { name: "Open link", exact: true }).click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(firstUrl);
  await popup.close();
  await page.getByRole("button", { name: "Read docs", exact: true }).click();
  await expect(dialog).toContainText(secondUrl);
});

test("dont show again opens other external links directly after reload", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Review PR", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Open external link?" });
  await dialog.getByRole("checkbox", { name: "Don't show this again" }).check();
  const firstPopupPromise = page.waitForEvent("popup");
  await dialog.getByRole("button", { name: "Open link", exact: true }).click();
  const firstPopup = await firstPopupPromise;
  await expect(firstPopup).toHaveURL(firstUrl);
  await firstPopup.close();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  const secondPopupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Read docs", exact: true }).click();
  const secondPopup = await secondPopupPromise;
  await expect(secondPopup).toHaveURL(secondUrl);
  await expect(dialog).toHaveCount(0);
  await secondPopup.close();
});

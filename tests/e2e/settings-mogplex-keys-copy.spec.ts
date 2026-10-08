import type { Page } from "@playwright/test";
import { test, expect, fulfillJson } from "./helpers/run-checks-fixtures";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";

const TOKEN = "mog_e2e_copy_token";

test.beforeEach(async ({ page }) => {
  await enableScopedE2EAuth(page);
  await page.route("**/api/settings/api-keys", (route) =>
    route.request().method() === "POST"
      ? fulfillJson(route, {
          id: "key-1",
          token: TOKEN,
          prefix: "mog_e2e",
          scopes: [],
          expiresAt: null,
        })
      : fulfillJson(route, { keys: [] })
  );
});

/**
 * Makes the async clipboard API reject the way it does when the document is
 * not focused, and records what the selection fallback copies.
 */
async function rejectAsyncClipboard(page: Page, fallbackWorks: boolean) {
  await page.addInitScript((works) => {
    const copies: string[] = [];
    Object.assign(window, { __copies: copies });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: () =>
          Promise.reject(
            new DOMException("Document is not focused.", "NotAllowedError")
          ),
      },
    });
    document.execCommand = (command: string) => {
      const active = document.activeElement;
      if (!works || command !== "copy") return false;
      if (active instanceof HTMLTextAreaElement) copies.push(active.value);
      return true;
    };
  }, fallbackWorks);
}

async function createKey(page: Page) {
  await page.goto(scopedPath("settings/mogplex-keys"));
  await page.getByRole("button", { name: "Generate New Key" }).click();
  await page.getByPlaceholder("e.g., laptop CLI, work machine").fill("laptop");
  await page.getByRole("button", { name: "Generate Key" }).click();
  await expect(page.getByText(TOKEN)).toBeVisible();
}

test("copying a new key falls back when the clipboard API rejects", async ({
  page,
}) => {
  await rejectAsyncClipboard(page, true);
  await createKey(page);

  await page.getByRole("button", { name: "Copy to Clipboard" }).click();

  await expect(page.getByRole("button", { name: "Copied!" })).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, "__copies"))).toEqual([
    TOKEN,
  ]);
});

test("copying a new key tells the user when every clipboard path fails", async ({
  page,
}) => {
  await rejectAsyncClipboard(page, false);
  await createKey(page);

  await page.getByRole("button", { name: "Copy to Clipboard" }).click();

  await expect(
    page.getByText("Select the key above and copy it manually")
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Copied!" })).toHaveCount(0);
});

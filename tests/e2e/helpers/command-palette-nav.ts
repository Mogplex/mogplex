import { expect, type Page } from "@playwright/test";

/**
 * Client-side navigation through the ⌘K palette, so app state (the shared
 * repos cache, open workspace) survives the move like a real user's would.
 */
export async function navigateWithPalette(page: Page, label: string) {
  await page.keyboard.press("ControlOrMeta+k");
  const search = page.getByPlaceholder(
    "Search projects, settings, and actions..."
  );
  await expect(search).toBeFocused();
  await search.fill(label.toLowerCase());
  // Navigate rows render as "→ <label>".
  await page
    .getByRole("option", { name: new RegExp(`^→\\s*${label}$`) })
    .click();
}

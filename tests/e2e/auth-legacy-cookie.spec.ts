import { expect, test } from "@playwright/test";
import { setForgedLegacyUserCookie, scopedPath } from "./helpers/auth";

test("legacy user_id cookie no longer authenticates protected pages", async ({
  page,
}) => {
  await setForgedLegacyUserCookie(page);

  await page.goto(scopedPath("projects/workspace"));

  await expect(page).toHaveURL(/\/login(?:\?|$)/);
});

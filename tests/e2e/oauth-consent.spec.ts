import { expect, test } from "@playwright/test";

test("expired or forged consent links explain how to reconnect without offering approval", async ({
  page,
}) => {
  await page.goto(
    "/oauth/consent?client_id=untrusted-name&redirect_uri=https%3A%2F%2Funtrusted.example&scope=read&sig=forged"
  );
  await expect(
    page.getByRole("heading", { name: "This connection request has expired." })
  ).toBeVisible();
  await expect(
    page.getByText("Return to the app and start connecting to Mogplex again.")
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Allow access" })).toHaveCount(
    0
  );
  await expect(
    page.getByRole("link", { name: "Sign in to Mogplex →" })
  ).toBeVisible();
});

import { expect, test } from "@playwright/test";

test("legacy CLI auth page gives curl-only update instructions", async ({
  page,
}) => {
  const response = await page.goto("/cli-auth");

  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "Update Mogplex to sign in" })
  ).toBeVisible();
  await expect(
    page.getByText("mogplex --update", { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText("curl -fsSL https://install.mogplex.com/install.sh | sh", {
      exact: true,
    })
  ).toBeVisible();
  await expect(page.getByText(/npm install/i)).toHaveCount(0);
});

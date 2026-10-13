import { expect, test } from "@playwright/test";
import { buildE2EAuthHeaders } from "./helpers/auth";

test.describe("self-hosting GitHub App setup", () => {
  test.beforeEach(async ({ page }) => {
    await page.context().setExtraHTTPHeaders(buildE2EAuthHeaders());
  });

  test("posts this deployment's App manifest to GitHub", async ({
    page,
    baseURL,
  }) => {
    await page.goto("/admin/setup/github");

    await expect(
      page.getByRole("heading", { name: "Create the GitHub App" })
    ).toBeVisible();

    const form = page.locator("form");
    await expect(form).toHaveAttribute(
      "action",
      /^https:\/\/github\.com\/settings\/apps\/new\?state=.+/
    );

    const manifest = JSON.parse(
      (await page.locator('input[name="manifest"]').inputValue()) || "{}"
    ) as { name: string; hook_attributes: { url: string } };
    expect(manifest.hook_attributes.url).toBe(`${baseURL}/api/webhooks/github`);

    await page.getByLabel("GitHub App name").fill("Acme Mogplex");
    await page.getByLabel("Organization (optional)").fill("acme-inc");
    await expect(form).toHaveAttribute(
      "action",
      /^https:\/\/github\.com\/organizations\/acme-inc\/settings\/apps\/new\?state=/
    );
    expect(
      JSON.parse(await page.locator('input[name="manifest"]').inputValue()).name
    ).toBe("Acme Mogplex");
  });

  test("blocks submission for an invalid organization", async ({ page }) => {
    await page.goto("/admin/setup/github");

    await page.getByLabel("Organization (optional)").fill("-acme");

    await expect(
      page.getByText("Enter a valid GitHub organization login.")
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create GitHub App on GitHub" })
    ).toBeDisabled();
  });

  test("refuses a completion link with a forged state", async ({ page }) => {
    await page.goto("/admin/setup/github/complete?code=abc&state=forged.mac");

    await expect(
      page.getByRole("heading", { name: "Setup link expired" })
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Start GitHub App setup" })
    ).toHaveAttribute("href", "/admin/setup/github");
  });
});

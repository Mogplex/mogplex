import { expect, test } from "@playwright/test";

test("public landing shows the open-source software engine and primary CTA", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  await expect(page.getByTestId("landing-hero")).toBeVisible();
  await expect(page).toHaveTitle(
    "Mogplex | The open-source engine for building and maintaining software"
  );
  await expect(
    page.getByRole("heading", {
      name: /The open-source engine for building and maintaining software\./,
    })
  ).toBeVisible();
  await expect(page.getByTestId("landing-primary-cta")).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: /Autonomy is a dial\. You set it per pipeline\./,
    })
  ).toBeVisible();

  await expect
    .poll(() => page.evaluate(() => document.fonts.check("44px Inter Tight")))
    .toBe(true);
  const headingFamilies = await page
    .locator(".mpx-landing h1, .mpx-landing h2, .mpx-landing h3")
    .evaluateAll((headings) =>
      headings.map((heading) => getComputedStyle(heading).fontFamily)
    );
  expect(headingFamilies.length).toBeGreaterThan(0);
  for (const fontFamily of headingFamilies) {
    expect(fontFamily).toContain("Inter Tight");
  }
});

test("retired access request route redirects to the rate card", async ({
  request,
}) => {
  const response = await request.get("/request-access", {
    maxRedirects: 0,
  });

  expect(response.status()).toBe(308);
  expect(response.headers().location).toBe("/pricing");
});

test("public marketing pages use the GA and PAYG copy", async ({ page }) => {
  const pages = [
    ["/workflows", "Pipelines worth stealing."],
    ["/how-it-works", "One run, drawn to scale."],
    ["/pricing", "Tokens at cost. Compute by the minute."],
    ["/faq", "Fair questions."],
    ["/company", "The company behind the system."],
    ["/signup", "Start now."],
  ] as const;

  for (const [path, heading] of pages) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    await expect(page.getByText(/private beta/i)).toHaveCount(0);
  }

  await page.goto("/pricing");
  await expect(page.getByText("TIER 00 — PAYG")).toBeVisible();
  await expect(page.getByText(/optional auto top-up/i)).toHaveCount(0);
  await expect(page.getByText(/custom \(min/i)).toHaveCount(0);

  await page.goto("/");
  await expect(
    page.getByRole("link", { name: "Self-hosting docs" })
  ).toHaveAttribute(
    "href",
    "https://github.com/mogplex/mogplex/blob/main/docs/self-hosting.md"
  );
  await expect(page.getByText("github.com/Mogplex/cli")).toHaveCount(0);
});

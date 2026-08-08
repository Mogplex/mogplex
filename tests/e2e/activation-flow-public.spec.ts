import { expect, test } from "@playwright/test";

test("public landing shows the open-source agent foundry and primary CTA", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  await expect(page.getByTestId("landing-hero")).toBeVisible();
  await expect(page).toHaveTitle("Mogplex | The open-source agent foundry");
  await expect(
    page.getByRole("heading", {
      name: /The open-source agent foundry\./,
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

test("landing offers three harnesses and drops retired chrome and claims", async ({
  page,
}) => {
  await page.goto("/");

  const harnessTabs = page.getByRole("tablist", {
    name: "Available coding harnesses",
  });
  await expect(
    harnessTabs.getByRole("tab", { name: "Mogplex Native" })
  ).toBeVisible();
  await expect(
    harnessTabs.getByRole("tab", { name: "Claude Code" })
  ).toBeVisible();
  await expect(harnessTabs.getByRole("tab", { name: "Codex" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /Not locked to our agent\./ })
  ).toBeVisible();

  await harnessTabs.getByRole("tab", { name: "Claude Code" }).click();
  await expect(
    page.getByText("Keep the Claude Code workflow you know", { exact: false })
  ).toBeVisible();

  // The fake version stamp and the retention promises are gone on purpose:
  // the stamp meant nothing, and data retention becomes a paid setting later.
  await expect(page.getByText(/CONTROL\s?PLANE/)).toHaveCount(0);
  await expect(page.getByText(/nothing carries over/i)).toHaveCount(0);
  await expect(page.getByText(/dies when the run ends/i)).toHaveCount(0);
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

  // Paid tier CTAs carry the plan into signup; PAYG has nothing to buy.
  await expect(page.getByTestId("pricing-cta-00")).toHaveAttribute(
    "href",
    "/signup"
  );
  await expect(page.getByTestId("pricing-cta-01")).toHaveAttribute(
    "href",
    "/signup?plan=pro"
  );
  await expect(page.getByTestId("pricing-cta-02")).toHaveAttribute(
    "href",
    "/signup?plan=team"
  );
  await expect(page.getByTestId("pricing-cta-03")).toHaveAttribute(
    "href",
    "/signup?plan=business"
  );

  // The plan survives to the signup form and names checkout as the next step.
  await page.goto("/signup?plan=business");
  await expect(page.getByTestId("plan-chip")).toContainText("Mog Mode");
  await expect(page.getByTestId("plan-chip")).toContainText("checkout");

  await page.goto("/");
  await expect(
    page.getByRole("link", { name: "Self-hosting docs" })
  ).toHaveAttribute(
    "href",
    "https://github.com/mogplex/mogplex/blob/main/docs/self-hosting.md"
  );
  await expect(page.getByText("github.com/Mogplex/cli")).toHaveCount(0);
});

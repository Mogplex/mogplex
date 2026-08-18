import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth } from "./helpers/auth";

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
  await expect(
    page.getByRole("heading", { name: /Give your company shared control\./ })
  ).toBeVisible();
  await expect(page.getByText(/no seat fees/i)).toHaveCount(0);
  await expect(page.getByText(/no sales call/i)).toHaveCount(0);

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

test("public marketing pages use the capacity pricing copy", async ({
  page,
}) => {
  const pages = [
    ["/workflows", "Pipelines worth stealing."],
    ["/how-it-works", "One run, drawn to scale."],
    ["/pricing", "Run more work. Know what it costs."],
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
  await expect(page.getByText("Team", { exact: true })).toHaveCount(0);
  await expect(page.getByText("PAYG", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/named user/i)).toHaveCount(0);
  await expect(page.getByText("$200/month", { exact: true })).toBeVisible();
  await expect(
    page.getByText("$1 of inference credit pays for $1 of model usage.")
  ).toBeVisible();
  await expect(page.getByText(/managed AI.*1\.25/i)).toHaveCount(0);

  // Individual plan intent survives through signup and checkout.
  await expect(page.getByTestId("pricing-cta-pro")).toHaveAttribute(
    "href",
    "/signup?plan=pro"
  );
  await expect(page.getByTestId("pricing-cta-plus")).toHaveAttribute(
    "href",
    "/signup?plan=plus"
  );
  await expect(page.getByTestId("pricing-cta-max")).toHaveAttribute(
    "href",
    "/signup?plan=max"
  );
  await page.getByRole("button", { name: "Annual, save 15%" }).click();
  await expect(
    page.locator(".price-value").filter({ hasText: "$1,020" })
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Contact sales" })
  ).toHaveAttribute("href", "mailto:enterprise@mogplex.com");

  await page.goto("/signup?plan=max");
  await expect(page.getByTestId("plan-chip")).toContainText("Max");
  await expect(page.getByTestId("plan-chip")).toContainText("Checkout");

  await page.goto("/terms");
  await expect(
    page.getByText(/model provider's published price with no markup/i)
  ).toBeVisible();
});

test("signed-in pricing choices go directly to checkout", async ({ page }) => {
  await enableScopedE2EAuth(page);
  await page.route("**/api/auth/get-session", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        session: {
          id: "session-1",
          userId: "user-1",
          expiresAt: "2026-08-19T12:00:00.000Z",
        },
        user: {
          id: "user-1",
          email: "alex@example.com",
          name: "Alex",
        },
      }),
    })
  );

  await page.goto("/pricing");

  await expect(page.getByTestId("pricing-cta-max")).toHaveAttribute(
    "href",
    "/checkout?plan=max"
  );

  await page.goto("/checkout?plan=max");
  await expect(
    page.getByText("Each $1 of inference credit pays for $1 of model usage.")
  ).toBeVisible();
});

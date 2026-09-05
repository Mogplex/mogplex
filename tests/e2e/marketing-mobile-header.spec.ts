import { expect, test, type Locator } from "@playwright/test";

/* Regression for #391 / #392: at phone widths the marketing header keeps
   only the brand, Start now, and the menu toggle. A broad
   `.mpx-button.is-small { margin-left: auto }` rule used to split the free
   space between brand → Sign in → Start now and right-align form submit
   buttons. These assertions go red if that selector comes back. */

const MOBILE_VIEWPORT = { width: 390, height: 844 };
const NAV_GAP_PX = 16;
const GAP_TOLERANCE_PX = 2;

async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`No bounding box for ${String(locator)}`);
  return box;
}

test.describe("marketing header on mobile", () => {
  test.use({ viewport: MOBILE_VIEWPORT });

  test("groups Start now and the menu toggle on the right and hides Sign in", async ({
    page,
  }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Primary navigation" });
    await expect(nav).toBeVisible();

    const brand = nav.getByRole("link", { name: "Mogplex home" });
    const signIn = nav.getByRole("link", { name: "Sign in" });
    const startNow = nav.getByRole("link", { name: "Start now" });
    const toggle = nav.getByRole("button", { name: "Open menu" });

    await expect(signIn).toBeHidden();
    await expect(startNow).toBeVisible();
    await expect(toggle).toBeVisible();

    const [navBox, brandBox, startBox, toggleBox] = await Promise.all([
      boxOf(nav),
      boxOf(brand),
      boxOf(startNow),
      boxOf(toggle),
    ]);

    // Start now and the toggle keep the nav's normal gap between them.
    const actionGap = toggleBox.x - (startBox.x + startBox.width);
    expect(Math.abs(actionGap - NAV_GAP_PX)).toBeLessThanOrEqual(
      GAP_TOLERANCE_PX
    );

    // All remaining free space sits between the brand and Start now, so the
    // actions hug the right edge rather than floating mid-bar.
    const brandToStart = startBox.x - (brandBox.x + brandBox.width);
    expect(brandToStart).toBeGreaterThan(NAV_GAP_PX * 4);
    const toggleToEdge =
      navBox.x + navBox.width - (toggleBox.x + toggleBox.width);
    expect(toggleToEdge).toBeLessThan(NAV_GAP_PX * 2);
  });

  test("keeps Sign in inside the mobile menu", async ({ page }) => {
    await page.goto("/");
    const mobileNav = page.getByRole("navigation", {
      name: "Mobile navigation",
    });
    await expect(mobileNav).toBeHidden();

    await page.getByRole("button", { name: "Open menu" }).click();

    await expect(mobileNav).toBeVisible();
    await expect(
      mobileNav.getByRole("link", { name: "Sign in" })
    ).toBeVisible();
  });

  test("leaves the new-code submit button flush with its form", async ({
    page,
  }) => {
    await page.goto("/login/new-code");
    const input = page.getByRole("textbox", { name: /email/i });
    const submit = page.getByRole("button", { name: /Email me a new code/ });
    await expect(submit).toBeVisible();

    const [inputBox, submitBox] = await Promise.all([
      boxOf(input),
      boxOf(submit),
    ]);
    expect(Math.abs(submitBox.x - inputBox.x)).toBeLessThanOrEqual(1);
  });

  test("leaves the waitlist submit button flush with its form", async ({
    page,
  }) => {
    await page.goto("/login/beta");
    const input = page.getByTestId("waitlist-code-input");
    const submit = page.getByTestId("login-github-button");
    await expect(submit).toBeVisible();

    const [inputBox, submitBox] = await Promise.all([
      boxOf(input),
      boxOf(submit),
    ]);
    expect(Math.abs(submitBox.x - inputBox.x)).toBeLessThanOrEqual(1);
  });
});

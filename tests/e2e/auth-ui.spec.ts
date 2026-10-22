// Browser coverage for the better-auth UI (/login, /signup, /forgot-password,
// /reset-password). The render tests are database-free; the journey tests
// mock nothing — the forms drive the real /api/auth handlers against real
// Neon rows — and self-skip when no connection string is resolvable.
import crypto from "node:crypto";
import { expect, test } from "@playwright/test";
import { Pool } from "pg";
import { resolveNeonDatabaseUrl } from "./helpers/neon";
import { seedPasswordUser } from "./helpers/password-user";

test.describe("auth pages render", () => {
  for (const surface of [
    { path: "/login", fields: [{ id: "signin-password", label: "password" }] },
    {
      path: "/reset-password?token=visibility-preview",
      fields: [
        { id: "reset-password-new", label: "new password" },
        { id: "reset-password-confirm", label: "confirm password" },
      ],
    },
  ]) {
    test(`${surface.path} lets users show and hide passwords without changing the value`, async ({
      page,
    }) => {
      await page.goto(surface.path);
      for (const field of surface.fields) {
        const input = page.getByTestId(field.id);
        await expect(input).toHaveAttribute("type", "password");
        const show = page.getByRole("button", {
          name: `Show ${field.label}`,
          exact: true,
        });
        await expect(show).toBeVisible();
        await input.fill("visibility-preview-123");
        await show.click();
        await expect(input).toHaveAttribute("type", "text");
        await expect(input).toHaveValue("visibility-preview-123");
        const hide = page.getByRole("button", {
          name: `Hide ${field.label}`,
          exact: true,
        });
        await expect(hide).toHaveAttribute("aria-pressed", "true");
        await hide.press("Enter");
        await expect(input).toHaveAttribute("type", "password");
        await expect(input).toHaveValue("visibility-preview-123");
      }
    });
  }

  test("/login shows the sign-in surface with social and SSO options", async ({
    page,
  }) => {
    await page.goto("/login");

    await expect(page.getByTestId("signin-form")).toBeVisible();
    await expect(page.getByTestId("signin-email")).toBeVisible();
    await expect(page.getByTestId("signin-password")).toBeVisible();
    await expect(page.getByTestId("auth-social-github")).toBeVisible();
    await expect(page.getByTestId("auth-social-google")).toBeVisible();
    await expect(page.getByTestId("auth-social-microsoft")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Use single sign-on (SSO) →" })
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Create an account" })
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Use the beta sign-in" })
    ).toHaveCount(0);
  });

  test("/signup offers social signup without email or password fields", async ({
    page,
  }) => {
    await page.goto("/signup");

    await expect(page.getByTestId("signup-form")).toHaveCount(0);
    await expect(page.getByRole("textbox")).toHaveCount(0);
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    for (const provider of ["github", "google", "microsoft"]) {
      await expect(page.getByTestId(`auth-social-${provider}`)).toBeVisible();
    }
    await expect(
      page.getByRole("main").getByRole("link", { name: "Sign in" })
    ).toBeVisible();
  });

  for (const [query, next] of [
    ["?plan=plus", "/checkout?plan=plus"],
    ["?next=%2Fwebrenew%2Fcontrol", "/webrenew/control"],
    ["?next=https%3A%2F%2Fevil.example", "/"],
  ]) {
    test(`social signup preserves a safe destination ${query}`, async ({
      page,
    }) => {
      await page.addInitScript(() => {
        window.__mogplexTrackedEvents = [];
      });
      await page.route("**/api/auth/sign-in/social", (route) =>
        route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({ message: "Provider unavailable" }),
        })
      );
      await page.goto(`/signup${query}`);
      const request = page.waitForRequest("**/api/auth/sign-in/social");
      await page.getByTestId("auth-social-github").click();
      expect((await request).postDataJSON()).toMatchObject({
        provider: "github",
        callbackURL: next,
      });
      expect(
        await page.evaluate(() => window.__mogplexTrackedEvents)
      ).toContainEqual({
        name: "signup_submitted",
        properties: { source: "signup_page", provider: "github" },
      });
    });
  }

  test("/forgot-password renders the reset request form", async ({ page }) => {
    await page.goto("/forgot-password");

    await expect(page.getByTestId("forgot-password-form")).toBeVisible();
    await expect(page.getByTestId("forgot-password-email")).toBeVisible();
  });

  test("social login does not count as a signup submission", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.__mogplexTrackedEvents = [];
    });
    await page.route("**/api/auth/sign-in/social", (route) => route.abort());
    await page.goto("/login");
    await page.getByTestId("auth-social-github").click();
    await expect(page.getByTestId("auth-social-error")).toBeVisible();
    const events = await page.evaluate(
      () => window.__mogplexTrackedEvents ?? []
    );
    expect(events).toContainEqual({
      name: "login_started",
      properties: { source: "login_page", provider: "github" },
    });
    expect(events.some((event) => event.name === "signup_submitted")).toBe(
      false
    );
  });

  test("/reset-password without a token shows the invalid-link state", async ({
    page,
  }) => {
    await page.goto("/reset-password");

    await expect(page.getByTestId("reset-password-invalid")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Request a new reset link" })
    ).toBeVisible();
  });

  test("/login/sso shows the work-email form", async ({ page }) => {
    await page.goto("/login/sso");

    await expect(page.getByTestId("sso-form")).toBeVisible();
    await expect(page.getByTestId("sso-email")).toBeVisible();
  });

  test("social sign-in surfaces a friendly error when the request fails", async ({
    page,
  }) => {
    // Abort instead of mocking a response: locally the provider may be fully
    // configured and the click would otherwise leave for github.com.
    await page.route("**/api/auth/sign-in/social", (route) => route.abort());

    await page.goto("/login");
    await page.getByTestId("auth-social-github").click();

    await expect(page.getByTestId("auth-social-error")).toBeVisible();
    await expect(page.getByTestId("auth-social-error")).toContainText(
      "Network error"
    );
  });
});

const databaseUrl = resolveNeonDatabaseUrl();
const password = "e2e-Ui-Password-1234";

function uniqueEmail(): string {
  return `e2e-ui-${Date.now()}-${crypto.randomUUID().slice(0, 8)}@e2e.mogplex.test`;
}

test.describe("auth UI against real Neon", () => {
  test.skip(
    !databaseUrl,
    "DATABASE_URL / mogplex_DATABASE_URL not resolvable — skipping real-database auth UI flows"
  );

  let pool: Pool;
  const createdEmails: string[] = [];

  test.beforeAll(() => {
    pool = new Pool({ connectionString: databaseUrl, max: 1 });
  });

  test.afterAll(async () => {
    // session/account/verification rows cascade from the user delete; the
    // profile row provisioned by the user-create hook has no FK and is
    // removed explicitly first.
    if (createdEmails.length > 0) {
      await pool.query(
        `delete from profiles where auth_user_id in
           (select id from "user" where email = any($1))`,
        [createdEmails]
      );
      await pool.query('delete from "user" where email = any($1)', [
        createdEmails,
      ]);
    }
    await pool.end();
  });

  test("existing password user: verification gate, sign-in, sign-out", async ({
    page,
  }) => {
    // Fresh fixture per attempt keeps CI retries independent.
    const email = uniqueEmail();
    createdEmails.push(email);

    await seedPasswordUser(pool, { email, password, verified: false });

    // requireEmailVerification gates the sign-in form until verified.
    await page.goto("/login");
    await page.getByTestId("signin-email").fill(email);
    await page.getByTestId("signin-password").fill(password);
    await page.getByTestId("signin-submit").click();
    await expect(page.getByTestId("signin-error")).toContainText(
      "Verify your email"
    );

    // Verify out-of-band (the emailed link is the production path).
    await pool.query(
      'update "user" set "emailVerified" = true where email = $1',
      [email]
    );

    await page.getByTestId("signin-password").fill("definitely-not-it-1234");
    await page.getByTestId("signin-submit").click();
    await expect(page.getByTestId("signin-error")).toContainText(
      "Invalid email or password"
    );

    await page.getByTestId("signin-password").fill(password);
    await page.getByTestId("signin-submit").click();
    // Successful sign-in leaves for "/" and the proxy bounces the now-authed
    // user into their scope's control surface.
    await page.waitForURL(/\/control$/);

    // Existing password accounts still resolve to their app profiles.
    if (process.env.MOGPLEX_DATA_BACKEND === "neon") {
      const profile = await pool.query(
        `select id, slug from profiles where auth_user_id =
           (select id from "user" where email = $1)`,
        [email]
      );
      expect(profile.rowCount).toBe(1);
      expect(String(profile.rows[0].slug)).toMatch(/^e2e-ui-/);

      const authUser = await page.request.get("/api/auth/user");
      expect(authUser.status(), await authUser.text()).toBe(200);
      const authUserBody = (await authUser.json()) as {
        user?: { id?: string; email?: string } | null;
      };
      expect(authUserBody.user?.email).toBe(email);
      expect(authUserBody.user?.id).toBe(String(profile.rows[0].id));
    }

    // Back on /login the session-aware panel replaces the form.
    await page.goto("/login");
    await expect(page.getByTestId("signed-in-panel")).toBeVisible();
    await expect(page.getByTestId("signed-in-panel")).toContainText(email);

    await page.getByTestId("signout-button").click();
    await expect(page.getByTestId("signin-form")).toBeVisible();
  });

  test("password reset journey: request link, set new password, sign in", async ({
    page,
  }) => {
    const email = uniqueEmail();
    createdEmails.push(email);
    const newPassword = "e2e-Ui-NewPassword-5678";

    const userId = await seedPasswordUser(pool, { email, password });

    await page.goto("/forgot-password");
    await page.getByTestId("forgot-password-email").fill(email);
    await page.getByTestId("forgot-password-submit").click();
    await expect(page.getByTestId("forgot-password-sent")).toBeVisible();

    // The reset email is log-delivered in e2e; recover the token from the
    // verification row better-auth wrote (identifier reset-password:<token>).
    const verification = await pool.query(
      `select identifier from "verification"
       where identifier like 'reset-password:%' and value = $1
       order by "createdAt" desc limit 1`,
      [userId]
    );
    expect(verification.rowCount).toBe(1);
    const token = (verification.rows[0].identifier as string).replace(
      "reset-password:",
      ""
    );

    await page.goto(`/reset-password?token=${encodeURIComponent(token)}`);
    await page.getByTestId("reset-password-new").fill(newPassword);
    await page.getByTestId("reset-password-confirm").fill(newPassword);
    await page.getByTestId("reset-password-submit").click();
    await page.waitForURL("/login?reset=1");
    await expect(page.getByText("password updated — sign in")).toBeVisible();

    // The new password signs in; the old one no longer does.
    await page.getByTestId("signin-email").fill(email);
    await page.getByTestId("signin-password").fill(password);
    await page.getByTestId("signin-submit").click();
    await expect(page.getByTestId("signin-error")).toContainText(
      "Invalid email or password"
    );

    await page.getByTestId("signin-password").fill(newPassword);
    await page.getByTestId("signin-submit").click();
    await page.waitForURL(/\/control$/);
  });
});

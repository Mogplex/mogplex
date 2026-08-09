// Browser coverage for the better-auth UI (/login, /signup, /forgot-password,
// /reset-password). The render tests are database-free; the journey tests
// mock nothing — the forms drive the real /api/auth handlers against real
// Neon rows — and self-skip when no connection string is resolvable.
import crypto from "node:crypto";
import { expect, test } from "@playwright/test";
import { Pool } from "pg";
import { resolveNeonDatabaseUrl } from "./helpers/neon";

test.describe("auth pages render", () => {
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

  test("/signup shows the account creation form", async ({ page }) => {
    await page.goto("/signup");

    await expect(page.getByTestId("signup-form")).toBeVisible();
    await expect(page.getByTestId("signup-name")).toBeVisible();
    await expect(page.getByTestId("signup-email")).toBeVisible();
    await expect(page.getByTestId("signup-password")).toBeVisible();
    await expect(page.getByTestId("auth-social-github")).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  });

  test("/forgot-password renders the reset request form", async ({ page }) => {
    await page.goto("/forgot-password");

    await expect(page.getByTestId("forgot-password-form")).toBeVisible();
    await expect(page.getByTestId("forgot-password-email")).toBeVisible();
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

  test("email/password journey: sign-up, verification gate, sign-in, sign-out", async ({
    page,
  }) => {
    // Fresh email per attempt so a CI retry doesn't trip USER_ALREADY_EXISTS.
    const email = uniqueEmail();
    createdEmails.push(email);

    await page.goto("/signup");
    await page.getByTestId("signup-name").fill("E2E Auth UI");
    await page.getByTestId("signup-email").fill(email);
    await page.getByTestId("signup-password").fill(password);
    await page.getByTestId("signup-submit").click();

    // The e2e server logs the verification email instead of sending; the UI
    // lands on the check-your-email panel and the row is real.
    await expect(page.getByTestId("signup-check-email")).toBeVisible();
    const created = await pool.query(
      'select id, "emailVerified" from "user" where email = $1',
      [email]
    );
    expect(created.rowCount).toBe(1);
    expect(created.rows[0].emailVerified).toBe(false);

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

    // With the Neon backend, the better-auth session resolves through
    // getResolvedAuth → profiles: the user-create hook provisioned a profile
    // row, so the app's own user endpoint recognizes the session.
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

    // Seed a verified user through the real sign-up API — this journey is
    // about the reset pages, not the sign-up form.
    const signUp = await page.request.post("/api/auth/sign-up/email", {
      data: { name: "E2E Reset UI", email, password },
    });
    expect(signUp.status(), await signUp.text()).toBe(200);
    const created = await pool.query('select id from "user" where email = $1', [
      email,
    ]);
    expect(created.rowCount).toBe(1);
    const userId = created.rows[0].id as string;
    await pool.query(
      'update "user" set "emailVerified" = true where email = $1',
      [email]
    );

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

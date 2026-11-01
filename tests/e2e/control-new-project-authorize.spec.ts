import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  fulfillJson,
  mockBaseChrome,
} from "./helpers/automation-control-plane-fixtures";

test("new project asks to authorize the personal account before creating there", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockBaseChrome(page);
  await page.route("**/api/connections", (route) =>
    fulfillJson(route, { connections: [] })
  );
  await page.route("**/api/repos**", (route) => fulfillJson(route, []));
  await page.route("**/api/control/sessions**", (route) =>
    fulfillJson(route, [])
  );
  await page.route("**/api/github/owners", (route) =>
    fulfillJson(route, [
      {
        login: "alex",
        kind: "personal",
        github_installation_id: null,
        scope_label: "Personal",
        source: "oauth",
        authorization_required: true,
      },
    ])
  );

  await page.goto(scopedPath("control"));
  await expect(
    page.getByText("Authorize Mogplex to create repositories in alex.")
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Authorize GitHub" })
  ).toHaveAttribute("href", /\/api\/auth\/github\/app-user\?next=/);
});

test("new project offers authorization when a create finds it missing", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockBaseChrome(page);
  await page.route("**/api/connections", (route) =>
    fulfillJson(route, { connections: [] })
  );
  await page.route("**/api/repos**", (route) => fulfillJson(route, []));
  await page.route("**/api/control/sessions**", (route) =>
    fulfillJson(route, [])
  );
  await page.route("**/api/github/owners", (route) =>
    fulfillJson(route, [
      {
        login: "alex",
        kind: "personal",
        github_installation_id: null,
        scope_label: "Personal",
        source: "oauth",
      },
    ])
  );
  await page.route("**/api/github/repos/availability**", (route) =>
    fulfillJson(route, { availability: "available" })
  );
  await page.route("**/api/github/repos", (route) =>
    fulfillJson(
      route,
      {
        code: "GITHUB_APP_USER_AUTHORIZATION_REQUIRED",
        error:
          "Authorize Mogplex to create repositories in alex, then try again.",
        authorize_url: "/api/auth/github/app-user",
      },
      403
    )
  );

  await page.goto(scopedPath("control"));
  await page
    .getByPlaceholder("Ask anything or run a command...")
    .fill("Ship account settings");
  await expect(
    page.getByRole("link", { name: "Authorize GitHub" })
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Start mission" }).click();

  await expect(
    page.getByText("Authorize Mogplex to create repositories in alex.")
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Authorize GitHub" })
  ).toHaveAttribute("href", /\/api\/auth\/github\/app-user\?next=/);
});

test("new project explains an authorization made with another GitHub account", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockBaseChrome(page);
  await page.route("**/api/connections", (route) =>
    fulfillJson(route, { connections: [] })
  );
  await page.route("**/api/repos**", (route) => fulfillJson(route, []));
  await page.route("**/api/control/sessions**", (route) =>
    fulfillJson(route, [])
  );
  await page.route("**/api/github/owners", (route) =>
    fulfillJson(route, [
      {
        login: "alex",
        kind: "personal",
        github_installation_id: null,
        scope_label: "Personal",
        source: "oauth",
        authorization_required: true,
      },
    ])
  );

  await page.goto(`${scopedPath("control")}?github_app_user=account_mismatch`);
  await expect(
    page.getByText("GitHub authorized a different account.", { exact: false })
  ).toBeVisible();
  await expect(page).not.toHaveURL(/github_app_user=/);
  await expect(
    page.getByRole("link", { name: "Authorize GitHub" })
  ).toHaveAttribute("href", /\/api\/auth\/github\/app-user\?next=/);
});

test("new project asks to install the App on a personal account first", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockBaseChrome(page);
  await page.route("**/api/connections", (route) =>
    fulfillJson(route, { connections: [] })
  );
  await page.route("**/api/repos**", (route) => fulfillJson(route, []));
  await page.route("**/api/control/sessions**", (route) =>
    fulfillJson(route, [])
  );
  await page.route("**/api/github/owners", (route) =>
    fulfillJson(route, [
      {
        login: "alex",
        kind: "personal",
        github_installation_id: null,
        scope_label: "Personal",
        source: "oauth",
        installation_required: true,
      },
    ])
  );

  await page.goto(scopedPath("control"));
  await expect(
    page.getByText(
      "Install the Mogplex GitHub App on alex to create repositories there."
    )
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Install GitHub App" })
  ).toHaveAttribute("href", /^\/api\/auth\/github\?next=/);
});

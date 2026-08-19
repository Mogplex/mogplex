import type { Page, Route } from "@playwright/test";

export async function fulfillJson(route: Route, data: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(data),
  });
}

export async function mockSettingsShell(page: Page) {
  await page.route("**/api/auth/user", (route) =>
    fulfillJson(route, {
      user: {
        id: "00000000-0000-4000-8000-000000000001",
        email: "alex@example.com",
        username: "alex",
        name: "Alex",
        avatar_url: "",
        github_connected: true,
        github_app_connected: true,
        github_app_available: true,
        platform_access: {
          allowPlatformAi: false,
          allowPlatformSandbox: false,
        },
        vercel: { connected: false },
      },
    })
  );
  await page.route(/\/api\/settings(?:\?.*)?$/, (route) =>
    fulfillJson(route, { default_model: null, theme: "light" })
  );
  await page.route("**/api/github/installations", (route) =>
    fulfillJson(route, [])
  );
  await page.route("**/api/github/owners", (route) => fulfillJson(route, []));
  await page.route("**/api/connections", (route) =>
    fulfillJson(route, { connections: [] })
  );
  await page.route("**/api/memberships", (route) =>
    fulfillJson(route, {
      personal: { slug: "alex", name: "Alex", avatarUrl: null },
      teams: [],
    })
  );
  await page.route("**/api/workspaces", (route) => fulfillJson(route, []));
  await page.route(/\/api\/repos(?:\?.*)?$/, (route) => fulfillJson(route, []));
  await page.route("**/api/agents", (route) => fulfillJson(route, []));
  await page.route("**/api/assignments", (route) => fulfillJson(route, []));
  await page.route("**/api/sandbox", (route) =>
    fulfillJson(route, { sandboxes: [] })
  );
  await page.route("**/api/billing/capacity/events?*", (route) =>
    route.fulfill({ status: 204 })
  );
}

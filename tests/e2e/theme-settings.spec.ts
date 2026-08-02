import { expect, test } from "@playwright/test";
import { enableE2EAuth } from "./helpers/auth";
import { linkedVercelCapability } from "./helpers/activation-fixtures";
import type { Page, Route } from "@playwright/test";

const modelId = "openai/gpt-5.4";

type TestThemePreference = "dark" | "light" | "system";

const connectedUser = {
  id: "user-1",
  email: "alex@example.com",
  username: "alex",
  name: "Alex",
  avatar_url: "https://example.com/avatar.png",
  github_connected: true,
  github_app_connected: true,
  github_app_available: true,
  github_connection_mode: "app" as const,
  platform_access: {
    allowPlatformAi: true,
    allowPlatformSandbox: true,
  },
  vercel: linkedVercelCapability,
};

const model = {
  id: modelId,
  provider: "openai",
  name: "GPT-5.4",
  context_length: 400000,
  pricing_input: 0.00000125,
  pricing_output: 0.00001,
  capabilities: ["reasoning", "tool-calling"],
  is_available: true,
  is_enabled: true,
};

const workspace = {
  id: "workspace-1",
  user_id: "user-1",
  name: "Core",
  description: "Main project workspace",
  is_default: true,
  created_at: "2026-03-27T00:00:00.000Z",
  updated_at: "2026-03-27T00:00:00.000Z",
};

const repo = {
  id: "repo-1",
  user_id: "user-1",
  workspace_id: workspace.id,
  full_name: "acme/credit-renew",
  owner: "acme",
  name: "credit-renew",
  default_branch: "main",
  github_id: 101,
  github_installation_id: 202,
  github_has_app_installation: true,
  github_app_covered: true,
  github_triggerable: true,
  is_favorite: true,
  root_directory: "web",
  created_at: "2026-03-27T00:00:00.000Z",
};

async function fulfillJson(route: Route, data: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(data),
  });
}

async function mockSettingsPageData(
  page: Page,
  installations: unknown[] = [],
  ownerTargets: unknown[] = [],
  userData: unknown = connectedUser
) {
  await page.route("**/api/auth/user", (route) =>
    fulfillJson(route, { user: userData })
  );
  await page.route(/\/api\/settings(?:\?.*)?$/, (route) =>
    fulfillJson(route, { default_model: modelId, theme: "light" })
  );
  await page.route("**/api/models", (route) =>
    fulfillJson(route, { models: [model], catalog: [model] })
  );
  await page.route("**/api/github/installations", (route) =>
    fulfillJson(route, installations)
  );
  await page.route("**/api/github/owners", (route) =>
    fulfillJson(route, ownerTargets)
  );
  await page.route("**/api/connections", (route) =>
    fulfillJson(route, { connections: [] })
  );
  await page.route("**/api/settings/keys", (route) =>
    fulfillJson(route, { keys: [] })
  );
  await page.route("**/api/workspaces", (route) =>
    fulfillJson(route, [workspace])
  );
  await page.route(/\/api\/repos(?:\?.*)?$/, (route) =>
    fulfillJson(route, [repo])
  );
  await page.route("**/api/agents", (route) => fulfillJson(route, []));
  await page.route("**/api/assignments", (route) => fulfillJson(route, []));
  await page.route("**/api/sandbox", (route) =>
    fulfillJson(route, { sandboxes: [] })
  );
}

async function readSearchInputTheme(page: Page) {
  return page.getByPlaceholder("Search spaces...").evaluate((element) => {
    const normalizeColor = (value: string) => {
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) return value;
      context.fillStyle = "#000000";
      context.fillStyle = value;
      return context.fillStyle;
    };

    const parseChannels = (value: string) => {
      if (value.startsWith("#")) {
        const hex = value.slice(1);
        const expanded =
          hex.length === 3
            ? hex
                .split("")
                .map((channel) => `${channel}${channel}`)
                .join("")
            : hex;

        return [
          Number.parseInt(expanded.slice(0, 2), 16),
          Number.parseInt(expanded.slice(2, 4), 16),
          Number.parseInt(expanded.slice(4, 6), 16),
        ];
      }

      const matches = value.match(/\d+(\.\d+)?/g) ?? [];
      const channels = matches.slice(0, 3).map(Number);
      const maxChannel = Math.max(...channels, 0);
      return maxChannel <= 1
        ? channels.map((channel) => channel * 255)
        : channels;
    };

    const brightness = (channels: number[]) =>
      channels.length === 3 ? (channels[0] + channels[1] + channels[2]) / 3 : 0;

    const styles = getComputedStyle(element);
    const rawBackground = styles.backgroundColor;
    const rawForeground = styles.color;
    const background = normalizeColor(rawBackground);
    const foreground = normalizeColor(rawForeground);

    return {
      rawBackground,
      rawForeground,
      background,
      foreground,
      backgroundBrightness: brightness(parseChannels(background)),
      foregroundBrightness: brightness(parseChannels(foreground)),
    };
  });
}

async function selectThemeFromUserMenu(page: Page, theme: TestThemePreference) {
  await page.getByRole("button", { name: "User menu" }).click();
  await page.getByTestId(`theme-switcher-${theme}`).click();
}

async function expectDocumentTheme(page: Page, theme: "dark" | "light") {
  const html = page.locator("html");
  await expect(html).toHaveClass(new RegExp(`(^| )${theme}( |$)`));
  await expect(html).not.toHaveClass(
    new RegExp(`(^| )${theme === "dark" ? "light" : "dark"}( |$)`)
  );
}

test("theme preference persists from user menu into spaces without UI regressions", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await enableE2EAuth(page);

  let theme: TestThemePreference = "light";
  const patchedThemes: string[] = [];
  const pageErrors: string[] = [];

  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  await page.route("**/api/auth/user", (route) =>
    fulfillJson(route, { user: connectedUser })
  );
  await page.route(/\/api\/settings(?:\?.*)?$/, async (route) => {
    if (route.request().method() === "PATCH") {
      const payload = JSON.parse(route.request().postData() || "{}") as {
        theme?: TestThemePreference;
        default_model?: string;
      };
      if (payload.theme) {
        theme = payload.theme;
        patchedThemes.push(payload.theme);
      }

      await fulfillJson(route, {
        default_model: payload.default_model ?? modelId,
        theme,
      });
      return;
    }

    await fulfillJson(route, { default_model: modelId, theme });
  });
  await page.route("**/api/models", (route) =>
    fulfillJson(route, { models: [model], catalog: [model] })
  );
  await page.route("**/api/integrations/slack/installations", (route) =>
    fulfillJson(route, { installations: [] })
  );
  await page.route("**/api/github/installations", (route) =>
    fulfillJson(route, [])
  );
  await page.route("**/api/github/owners", (route) => fulfillJson(route, []));
  await page.route("**/api/connections", (route) =>
    fulfillJson(route, { connections: [] })
  );
  await page.route("**/api/settings/keys", (route) =>
    fulfillJson(route, { keys: [] })
  );
  await page.route("**/api/workspaces", (route) =>
    fulfillJson(route, [workspace])
  );
  await page.route(/\/api\/repos(?:\?.*)?$/, (route) =>
    fulfillJson(route, [repo])
  );
  await page.route("**/api/agents", (route) => fulfillJson(route, []));
  await page.route("**/api/assignments", (route) => fulfillJson(route, []));
  await page.route("**/api/sandbox", (route) =>
    fulfillJson(route, { sandboxes: [] })
  );

  await page.goto("/projects/repositories");
  await page.waitForLoadState("networkidle");

  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.classList.contains("dark"))
    )
    .toBe(false);

  const initialLightTheme = await readSearchInputTheme(page);
  expect(initialLightTheme.rawBackground.length).toBeGreaterThan(0);
  expect(initialLightTheme.rawForeground.length).toBeGreaterThan(0);

  await selectThemeFromUserMenu(page, "dark");
  await expectDocumentTheme(page, "dark");

  const darkTheme = await readSearchInputTheme(page);
  expect(darkTheme.rawBackground).not.toBe(initialLightTheme.rawBackground);
  expect(darkTheme.rawForeground).not.toBe(initialLightTheme.rawForeground);

  await selectThemeFromUserMenu(page, "light");
  await expectDocumentTheme(page, "light");

  const restoredLightTheme = await readSearchInputTheme(page);
  expect(restoredLightTheme.rawBackground).toBe(
    initialLightTheme.rawBackground
  );
  expect(restoredLightTheme.rawForeground).toBe(
    initialLightTheme.rawForeground
  );

  expect(patchedThemes).toEqual(["dark", "light"]);
  expect(pageErrors).toEqual([]);
});

test("global theme sync ignores stale settings reads after local theme selection", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await enableE2EAuth(page);

  let theme: TestThemePreference = "light";
  let staleReadHeld = false;
  const patchedThemes: string[] = [];
  let resolveStaleRead = () => {};
  let releaseStaleRead = () => {};
  const staleReadReady = new Promise<void>((resolve) => {
    resolveStaleRead = resolve;
  });
  const staleReadReleased = new Promise<void>((resolve) => {
    releaseStaleRead = resolve;
  });

  await page.route("**/api/auth/user", (route) =>
    fulfillJson(route, { user: connectedUser })
  );
  await page.route(/\/api\/settings(?:\?.*)?$/, async (route) => {
    if (route.request().method() === "PATCH") {
      const payload = JSON.parse(route.request().postData() || "{}") as {
        theme?: TestThemePreference;
      };
      if (payload.theme) {
        theme = payload.theme;
        patchedThemes.push(payload.theme);
      }
      await fulfillJson(route, { ok: true });
      return;
    }

    if (!staleReadHeld) {
      staleReadHeld = true;
      resolveStaleRead();
      await staleReadReleased;
      await fulfillJson(route, { default_model: modelId, theme: "light" });
      return;
    }

    await fulfillJson(route, { default_model: modelId, theme });
  });
  await page.route("**/api/models", (route) =>
    fulfillJson(route, { models: [model], catalog: [model] })
  );
  await page.route("**/api/integrations/slack/installations", (route) =>
    fulfillJson(route, { installations: [] })
  );
  await page.route("**/api/github/installations", (route) =>
    fulfillJson(route, [])
  );
  await page.route("**/api/github/owners", (route) => fulfillJson(route, []));
  await page.route("**/api/connections", (route) =>
    fulfillJson(route, { connections: [] })
  );
  await page.route("**/api/settings/keys", (route) =>
    fulfillJson(route, { keys: [] })
  );
  await page.route("**/api/workspaces", (route) =>
    fulfillJson(route, [workspace])
  );
  await page.route(/\/api\/repos(?:\?.*)?$/, (route) =>
    fulfillJson(route, [repo])
  );
  await page.route("**/api/agents", (route) => fulfillJson(route, []));
  await page.route("**/api/assignments", (route) => fulfillJson(route, []));
  await page.route("**/api/sandbox", (route) =>
    fulfillJson(route, { sandboxes: [] })
  );

  await page.goto("/projects/repositories");
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  await staleReadReady;
  await expectDocumentTheme(page, "light");

  await selectThemeFromUserMenu(page, "dark");
  await expectDocumentTheme(page, "dark");
  await expect.poll(() => patchedThemes).toEqual(["dark"]);

  // Register before unblocking the held route; resolving the Node-side gate has
  // an async hop before the mocked response is fulfilled.
  const staleSettingsReadResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/settings" && response.request().method() === "GET"
    );
  });
  releaseStaleRead();
  await staleSettingsReadResponse;
  await expectDocumentTheme(page, "dark");
});

test("user menu theme submenu opens and persists selection", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await enableE2EAuth(page);

  let theme: TestThemePreference = "light";
  const patchedThemes: string[] = [];

  await page.route("**/api/auth/user", (route) =>
    fulfillJson(route, { user: connectedUser })
  );
  await page.route(/\/api\/settings(?:\?.*)?$/, async (route) => {
    if (route.request().method() === "PATCH") {
      const payload = JSON.parse(route.request().postData() || "{}") as {
        theme?: TestThemePreference;
      };
      if (payload.theme) {
        theme = payload.theme;
        patchedThemes.push(payload.theme);
      }
      await fulfillJson(route, { ok: true });
      return;
    }

    await fulfillJson(route, { default_model: modelId, theme });
  });
  await page.route("**/api/models", (route) =>
    fulfillJson(route, { models: [model], catalog: [model] })
  );
  await page.route("**/api/integrations/slack/installations", (route) =>
    fulfillJson(route, { installations: [] })
  );
  await page.route("**/api/github/installations", (route) =>
    fulfillJson(route, [])
  );
  await page.route("**/api/github/owners", (route) => fulfillJson(route, []));
  await page.route("**/api/connections", (route) =>
    fulfillJson(route, { connections: [] })
  );
  await page.route("**/api/settings/keys", (route) =>
    fulfillJson(route, { keys: [] })
  );
  await page.route("**/api/workspaces", (route) =>
    fulfillJson(route, [workspace])
  );
  await page.route(/\/api\/repos(?:\?.*)?$/, (route) =>
    fulfillJson(route, [repo])
  );
  await page.route("**/api/agents", (route) => fulfillJson(route, []));
  await page.route("**/api/assignments", (route) => fulfillJson(route, []));
  await page.route("**/api/sandbox", (route) =>
    fulfillJson(route, { sandboxes: [] })
  );

  await page.goto("/projects/repositories");
  await page.waitForLoadState("networkidle");

  await selectThemeFromUserMenu(page, "dark");

  await expectDocumentTheme(page, "dark");
  expect(patchedThemes).toEqual(["dark"]);
});

test("user menu theme save failures roll back only the latest selection", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await enableE2EAuth(page);

  let theme: TestThemePreference = "light";
  const patchedThemes: string[] = [];
  let darkPatchCount = 0;
  let resolveFirstDarkPatch = () => {};
  let releaseFirstDarkPatch = () => {};
  let resolveLightPatch = () => {};
  const firstDarkPatchReady = new Promise<void>((resolve) => {
    resolveFirstDarkPatch = resolve;
  });
  const firstDarkPatchReleased = new Promise<void>((resolve) => {
    releaseFirstDarkPatch = resolve;
  });
  const lightPatchReady = new Promise<void>((resolve) => {
    resolveLightPatch = resolve;
  });

  await page.route("**/api/auth/user", (route) =>
    fulfillJson(route, { user: connectedUser })
  );
  await page.route(/\/api\/settings(?:\?.*)?$/, async (route) => {
    if (route.request().method() === "PATCH") {
      const payload = JSON.parse(route.request().postData() || "{}") as {
        theme?: TestThemePreference;
      };
      if (!payload.theme) {
        await fulfillJson(route, { ok: true });
        return;
      }

      patchedThemes.push(payload.theme);
      if (payload.theme === "dark") {
        darkPatchCount += 1;
        if (darkPatchCount === 1) {
          resolveFirstDarkPatch();
          await firstDarkPatchReleased;
          await fulfillJson(route, { error: "save failed" }, 500);
          return;
        }

        await fulfillJson(route, { error: "save failed" }, 500);
        return;
      }

      theme = payload.theme;
      resolveLightPatch();
      await fulfillJson(route, { ok: true });
      return;
    }

    await fulfillJson(route, { default_model: modelId, theme });
  });
  await page.route("**/api/models", (route) =>
    fulfillJson(route, { models: [model], catalog: [model] })
  );
  await page.route("**/api/integrations/slack/installations", (route) =>
    fulfillJson(route, { installations: [] })
  );
  await page.route("**/api/github/installations", (route) =>
    fulfillJson(route, [])
  );
  await page.route("**/api/github/owners", (route) => fulfillJson(route, []));
  await page.route("**/api/connections", (route) =>
    fulfillJson(route, { connections: [] })
  );
  await page.route("**/api/settings/keys", (route) =>
    fulfillJson(route, { keys: [] })
  );
  await page.route("**/api/workspaces", (route) =>
    fulfillJson(route, [workspace])
  );
  await page.route(/\/api\/repos(?:\?.*)?$/, (route) =>
    fulfillJson(route, [repo])
  );
  await page.route("**/api/agents", (route) => fulfillJson(route, []));
  await page.route("**/api/assignments", (route) => fulfillJson(route, []));
  await page.route("**/api/sandbox", (route) =>
    fulfillJson(route, { sandboxes: [] })
  );

  await page.goto("/projects/repositories");
  await page.waitForLoadState("networkidle");

  await expectDocumentTheme(page, "light");
  await selectThemeFromUserMenu(page, "dark");
  await firstDarkPatchReady;
  await expectDocumentTheme(page, "dark");

  await selectThemeFromUserMenu(page, "light");
  await lightPatchReady;
  await expectDocumentTheme(page, "light");
  expect(patchedThemes).toEqual(["dark", "light"]);

  releaseFirstDarkPatch();
  await expectDocumentTheme(page, "light");

  await selectThemeFromUserMenu(page, "dark");
  await expect(page.getByText("Theme preference not saved")).toBeVisible();
  await expectDocumentTheme(page, "light");
  expect(patchedThemes).toEqual(["dark", "light", "dark"]);
});

test("user menu theme failures restore the last confirmed saved theme", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await enableE2EAuth(page);

  const patchedThemes: string[] = [];
  let resolveDarkPatch = () => {};
  let releaseDarkPatch = () => {};
  let resolveSystemPatch = () => {};
  const darkPatchReady = new Promise<void>((resolve) => {
    resolveDarkPatch = resolve;
  });
  const darkPatchReleased = new Promise<void>((resolve) => {
    releaseDarkPatch = resolve;
  });
  const systemPatchReady = new Promise<void>((resolve) => {
    resolveSystemPatch = resolve;
  });

  await page.route("**/api/auth/user", (route) =>
    fulfillJson(route, { user: connectedUser })
  );
  await page.route(/\/api\/settings(?:\?.*)?$/, async (route) => {
    if (route.request().method() === "PATCH") {
      const payload = JSON.parse(route.request().postData() || "{}") as {
        theme?: TestThemePreference;
      };
      if (!payload.theme) {
        await fulfillJson(route, { ok: true });
        return;
      }

      patchedThemes.push(payload.theme);
      if (payload.theme === "dark") {
        resolveDarkPatch();
        await darkPatchReleased;
        await fulfillJson(route, { error: "save failed" }, 500);
        return;
      }

      resolveSystemPatch();
      await fulfillJson(route, { error: "save failed" }, 500);
      return;
    }

    await fulfillJson(route, { default_model: modelId, theme: "light" });
  });
  await page.route("**/api/models", (route) =>
    fulfillJson(route, { models: [model], catalog: [model] })
  );
  await page.route("**/api/integrations/slack/installations", (route) =>
    fulfillJson(route, { installations: [] })
  );
  await page.route("**/api/github/installations", (route) =>
    fulfillJson(route, [])
  );
  await page.route("**/api/github/owners", (route) => fulfillJson(route, []));
  await page.route("**/api/connections", (route) =>
    fulfillJson(route, { connections: [] })
  );
  await page.route("**/api/settings/keys", (route) =>
    fulfillJson(route, { keys: [] })
  );
  await page.route("**/api/workspaces", (route) =>
    fulfillJson(route, [workspace])
  );
  await page.route(/\/api\/repos(?:\?.*)?$/, (route) =>
    fulfillJson(route, [repo])
  );
  await page.route("**/api/agents", (route) => fulfillJson(route, []));
  await page.route("**/api/assignments", (route) => fulfillJson(route, []));
  await page.route("**/api/sandbox", (route) =>
    fulfillJson(route, { sandboxes: [] })
  );

  await page.goto("/projects/repositories");
  await page.waitForLoadState("networkidle");

  await expectDocumentTheme(page, "light");
  await selectThemeFromUserMenu(page, "dark");
  await darkPatchReady;
  await expectDocumentTheme(page, "dark");

  await selectThemeFromUserMenu(page, "system");
  await systemPatchReady;
  await expect(page.getByText("Theme preference not saved")).toBeVisible();
  await expectDocumentTheme(page, "light");

  releaseDarkPatch();
  await expectDocumentTheme(page, "light");
  expect(patchedThemes).toEqual(["dark", "system"]);
});

test("settings renders org-scoped GitHub installation links", async ({
  page,
}) => {
  await enableE2EAuth(page);
  await mockSettingsPageData(page, [
    {
      id: "inst-1",
      installation_id: 117860437,
      account_login: "acme",
      account_type: "Organization",
      target_type: "Organization",
      repository_count: 1,
      synced_repo_count: 1,
      scope_label: "Org",
      manage_url:
        "https://github.com/organizations/acme/settings/installations/117860437",
      repositories: [{ id: repo.id, full_name: repo.full_name }],
    },
  ]);

  await page.goto("/settings?tab=account");
  await page.waitForLoadState("networkidle");

  const manageLink = page.getByRole("link", { name: "Manage on GitHub" });
  await expect(manageLink).toHaveAttribute(
    "href",
    "https://github.com/organizations/acme/settings/installations/117860437"
  );
});

test("settings keeps an add-install entry point visible after GitHub App setup", async ({
  page,
}) => {
  await enableE2EAuth(page);
  await mockSettingsPageData(
    page,
    [
      {
        id: "inst-1",
        installation_id: 117860437,
        account_login: "acme",
        account_type: "Organization",
        target_type: "Organization",
        repository_count: 1,
        synced_repo_count: 1,
        scope_label: "Org",
        manage_url:
          "https://github.com/organizations/acme/settings/installations/117860437",
        repositories: [{ id: repo.id, full_name: repo.full_name }],
      },
    ],
    [
      {
        login: "alex",
        kind: "personal",
        github_installation_id: null,
        scope_label: "Personal",
        source: "oauth",
      },
      {
        login: "acme",
        kind: "org",
        github_installation_id: 117860437,
        scope_label: "Org",
        source: "oauth+installation",
      },
    ],
    {
      ...connectedUser,
      github_state: "app_installed_with_synced_repos",
      github_status_label: "Ready",
      github_status_detail:
        "GitHub App coverage is active and synced repositories are available in Projects.",
      github_primary_action: null,
      github_installation_count: 1,
      github_synced_repo_count: 1,
    }
  );

  await page.goto("/settings?tab=account");
  await page.waitForLoadState("networkidle");

  await expect(page.getByTestId("settings-github-add-install")).toHaveAttribute(
    "href",
    "/api/auth/github"
  );
  await expect(page.getByText("Available accounts")).toBeVisible();
  await expect(page.getByText("alex")).toBeVisible();
  await expect(
    page.getByText("OAuth can see it, but App coverage is missing")
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Add in GitHub" })).toBeVisible();
});

test("settings hides broken GitHub installation manage links when metadata is incomplete", async ({
  page,
}) => {
  await enableE2EAuth(page);
  await mockSettingsPageData(page, [
    {
      id: "inst-1",
      installation_id: 117860437,
      account_login: "acme",
      account_type: null,
      target_type: null,
      repository_count: 1,
      synced_repo_count: 1,
      scope_label: "Account",
      manage_url: null,
      repositories: [{ id: repo.id, full_name: repo.full_name }],
    },
  ]);

  await page.goto("/settings?tab=account");
  await page.waitForLoadState("networkidle");

  await expect(
    page.getByText(
      "Manage in GitHub settings unavailable until installation metadata is refreshed"
    )
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Manage on GitHub" })
  ).toHaveCount(0);
});

test("settings surfaces installation load failures without crashing", async ({
  page,
}) => {
  await enableE2EAuth(page);
  const pageErrors: string[] = [];

  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  await page.route("**/api/auth/user", (route) =>
    fulfillJson(route, { user: connectedUser })
  );
  await page.route(/\/api\/settings(?:\?.*)?$/, (route) =>
    fulfillJson(route, { default_model: modelId, theme: "light" })
  );
  await page.route("**/api/models", (route) =>
    fulfillJson(route, { models: [model], catalog: [model] })
  );
  await page.route("**/api/github/installations", (route) =>
    fulfillJson(route, { error: "Failed to load GitHub installations" }, 500)
  );
  await page.route("**/api/github/owners", (route) => fulfillJson(route, []));
  await page.route("**/api/connections", (route) =>
    fulfillJson(route, { connections: [] })
  );
  await page.route("**/api/settings/keys", (route) =>
    fulfillJson(route, { keys: [] })
  );
  await page.route("**/api/workspaces", (route) =>
    fulfillJson(route, [workspace])
  );
  await page.route(/\/api\/repos(?:\?.*)?$/, (route) =>
    fulfillJson(route, [repo])
  );
  await page.route("**/api/agents", (route) => fulfillJson(route, []));
  await page.route("**/api/assignments", (route) => fulfillJson(route, []));
  await page.route("**/api/sandbox", (route) =>
    fulfillJson(route, { sandboxes: [] })
  );

  await page.goto("/settings?tab=account");
  await page.waitForLoadState("networkidle");

  await expect(
    page.getByText("Unable to load GitHub App installations")
  ).toBeVisible();
  await expect(page.getByText("GitHub App coverage")).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("settings surfaces settings preference load failures without crashing", async ({
  page,
}) => {
  await enableE2EAuth(page);
  const pageErrors: string[] = [];

  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  await page.route("**/api/auth/user", (route) =>
    fulfillJson(route, { user: connectedUser })
  );
  await page.route(/\/api\/settings(?:\?.*)?$/, (route) =>
    fulfillJson(route, { error: "Failed to load settings" }, 500)
  );
  await page.route("**/api/models", (route) =>
    fulfillJson(route, { models: [model], catalog: [model] })
  );
  await page.route("**/api/github/installations", (route) =>
    fulfillJson(route, [])
  );
  await page.route("**/api/github/owners", (route) => fulfillJson(route, []));
  await page.route("**/api/connections", (route) =>
    fulfillJson(route, { connections: [] })
  );
  await page.route("**/api/settings/keys", (route) =>
    fulfillJson(route, { keys: [] })
  );
  await page.route("**/api/workspaces", (route) =>
    fulfillJson(route, [workspace])
  );
  await page.route(/\/api\/repos(?:\?.*)?$/, (route) =>
    fulfillJson(route, [repo])
  );
  await page.route("**/api/agents", (route) => fulfillJson(route, []));
  await page.route("**/api/assignments", (route) => fulfillJson(route, []));
  await page.route("**/api/sandbox", (route) =>
    fulfillJson(route, { sandboxes: [] })
  );

  await page.goto("/settings?tab=account");
  await page.waitForLoadState("networkidle");

  await expect(
    page.getByText("Unable to load settings preferences")
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  expect(pageErrors).toEqual([]);
});

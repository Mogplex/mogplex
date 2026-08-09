import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  connectedUser,
  modelId,
  model,
  workspace,
  repo,
  fulfillJson,
  readSearchInputTheme,
  selectThemeFromUserMenu,
  expectDocumentTheme,
} from "./helpers/theme-settings-fixtures";
import type { TestThemePreference } from "./helpers/theme-settings-fixtures";

test("theme preference persists from user menu into spaces without UI regressions", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await enableScopedE2EAuth(page);

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

  await page.goto(scopedPath("projects/repositories"));
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
  expect(initialLightTheme.backgroundBrightness).toBeGreaterThan(180);
  expect(initialLightTheme.foregroundBrightness).toBeLessThan(120);

  await selectThemeFromUserMenu(page, "dark");
  await expectDocumentTheme(page, "dark");

  await expect
    .poll(async () => {
      const darkPreferenceChromeTheme = await readSearchInputTheme(page);
      return {
        backgroundSettled: darkPreferenceChromeTheme.backgroundBrightness < 80,
        foregroundSettled: darkPreferenceChromeTheme.foregroundBrightness > 120,
      };
    })
    .toEqual({ backgroundSettled: true, foregroundSettled: true });

  await selectThemeFromUserMenu(page, "light");
  await expectDocumentTheme(page, "light");

  await expect
    .poll(async () => {
      const restoredLightTheme = await readSearchInputTheme(page);
      return {
        backgroundSettled: restoredLightTheme.backgroundBrightness > 180,
        foregroundSettled: restoredLightTheme.foregroundBrightness < 120,
      };
    })
    .toEqual({ backgroundSettled: true, foregroundSettled: true });

  expect(patchedThemes).toEqual(["dark", "light"]);
  expect(pageErrors).toEqual([]);
});

test("global theme sync ignores stale settings reads after local theme selection", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await enableScopedE2EAuth(page);

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

  await page.goto(scopedPath("projects/repositories"));
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
  await enableScopedE2EAuth(page);

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

  await page.goto(scopedPath("projects/repositories"));
  await page.waitForLoadState("networkidle");

  await selectThemeFromUserMenu(page, "dark");

  await expectDocumentTheme(page, "dark");
  expect(patchedThemes).toEqual(["dark"]);
});

test("user menu theme save failures roll back only the latest selection", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await enableScopedE2EAuth(page);

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

  await page.goto(scopedPath("projects/repositories"));
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
  await expect(
    page.getByText("Theme preference not saved").first()
  ).toBeVisible();
  await expectDocumentTheme(page, "light");
  expect(patchedThemes).toEqual(["dark", "light", "dark"]);
});

test("user menu theme failures restore the last confirmed saved theme", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await enableScopedE2EAuth(page);

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

  await page.goto(scopedPath("projects/repositories"));
  await page.waitForLoadState("networkidle");

  await expectDocumentTheme(page, "light");
  await selectThemeFromUserMenu(page, "dark");
  await darkPatchReady;
  await expectDocumentTheme(page, "dark");

  await selectThemeFromUserMenu(page, "system");
  await systemPatchReady;
  await expect(
    page.getByText("Theme preference not saved").first()
  ).toBeVisible();
  await expectDocumentTheme(page, "light");

  releaseDarkPatch();
  await expectDocumentTheme(page, "light");
  expect(patchedThemes).toEqual(["dark", "system"]);
});

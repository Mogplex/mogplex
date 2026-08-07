import { linkedVercelCapability } from "./activation-fixtures";
import type { Page, Route } from "@playwright/test";
import { expect } from "@playwright/test";

export const modelId = "openai/gpt-5.4";

export type TestThemePreference = "dark" | "light" | "system";

export const connectedUser = {
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

export const model = {
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

export const workspace = {
  id: "workspace-1",
  user_id: "user-1",
  name: "Core",
  description: "Main project workspace",
  is_default: true,
  created_at: "2026-03-27T00:00:00.000Z",
  updated_at: "2026-03-27T00:00:00.000Z",
};

export const repo = {
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

export async function fulfillJson(route: Route, data: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(data),
  });
}

export async function mockSettingsPageData(
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

export async function readSearchInputTheme(page: Page) {
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

export async function selectThemeFromUserMenu(
  page: Page,
  theme: TestThemePreference
) {
  await page.getByRole("button", { name: "User menu" }).click();
  await page.getByTestId(`theme-switcher-${theme}`).click();
  // Close the dropdown - theme switcher uses stopPropagation to stay open
  await page.keyboard.press("Escape");
}

export async function expectDocumentTheme(page: Page, theme: "dark" | "light") {
  const html = page.locator("html");
  await expect(html).toHaveClass(new RegExp(`(^| )${theme}( |$)`));
  await expect(html).not.toHaveClass(
    new RegExp(`(^| )${theme === "dark" ? "light" : "dark"}( |$)`)
  );
}

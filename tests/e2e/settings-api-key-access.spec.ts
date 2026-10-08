import {
  expect,
  fulfillJson,
  mockTeamSettings,
  TEAM_KEY_ACCESS_ENDPOINT,
  TEAM_SETTINGS_PATH,
  test,
} from "./helpers/run-checks-fixtures";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";

const KEY = {
  id: "key-1",
  name: "webrenew",
  prefix: "mog_e2e",
  scopes: ["read", "write"],
  createdAt: "2026-10-01T00:00:00Z",
  lastUsedAt: null,
  expiresAt: null,
};

test("an account owner creates an automations-only key and can change it later", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  const keys: Array<typeof KEY & { access: string }> = [];
  const created: unknown[] = [];
  const patched: unknown[] = [];
  await page.route("**/api/settings/api-keys", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { access: string };
      created.push(body);
      keys.push({ ...KEY, access: body.access });
      return fulfillJson(route, {
        id: KEY.id,
        token: "mog_e2e_token",
        prefix: KEY.prefix,
        scopes: KEY.scopes,
        access: body.access,
        expiresAt: null,
      });
    }
    return fulfillJson(route, { keys });
  });
  await page.route(`**/api/settings/api-keys/${KEY.id}`, async (route) => {
    const body = route.request().postDataJSON() as { access: string };
    patched.push(body);
    keys[0] = { ...keys[0], access: body.access };
    return fulfillJson(route, { id: KEY.id, access: body.access });
  });

  await page.goto(scopedPath("settings/mogplex-keys"));
  await page.getByRole("button", { name: "Generate New Key" }).click();
  await page
    .getByPlaceholder("e.g., laptop CLI, work machine")
    .fill("webrenew");
  const access = page.getByRole("radiogroup", { name: "Access" });
  await expect(
    access.getByRole("radio", { name: /Full access/ })
  ).toBeChecked();
  await access.getByRole("radio", { name: /Automations only/ }).click();
  await page.getByRole("button", { name: "Generate Key" }).click();
  await expect(page.getByText("mog_e2e_token")).toBeVisible();
  expect(created).toEqual([
    expect.objectContaining({ name: "webrenew", access: "automations" }),
  ]);

  await page.getByRole("button", { name: "Done" }).click();
  await expect(
    page.getByText("Automations only", { exact: true })
  ).toBeVisible();

  await page.getByRole("button", { name: "Allow full access" }).click();
  await expect(page.getByText("Full access", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Limit to automations" })
  ).toBeVisible();
  expect(patched).toEqual([{ access: "full" }]);
});

test("a team owner holds members' keys to automations on the team's repositories", async ({
  page,
}) => {
  await mockTeamSettings(page, "owner");
  let access = "full";
  const patches: unknown[] = [];
  await page.route(TEAM_KEY_ACCESS_ENDPOINT, async (route) => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON() as { access: string };
      patches.push(body);
      access = body.access;
    }
    await fulfillJson(route, { access, viewer: { canManage: true } });
  });

  await page.goto(`${TEAM_SETTINGS_PATH}/keys`);
  const group = page.getByRole("radiogroup", {
    name: "Mogplex API key access for this team",
  });
  await expect(
    group.getByRole("radio", { name: /Each key's own access/ })
  ).toBeChecked();
  await group.getByRole("radio", { name: /Automations only/ }).click();
  await expect(
    group.getByRole("radio", { name: /Automations only/ })
  ).toBeChecked();
  expect(patches).toEqual([{ access: "automations" }]);

  await page.reload();
  await expect(
    group.getByRole("radio", { name: /Automations only/ })
  ).toBeChecked();
});

for (const role of ["admin", "developer", "viewer"] as const) {
  test(`team API key access is read-only for a ${role}`, async ({ page }) => {
    await mockTeamSettings(page, role);
    const methods: string[] = [];
    await page.route(TEAM_KEY_ACCESS_ENDPOINT, async (route) => {
      methods.push(route.request().method());
      await fulfillJson(route, {
        access: "automations",
        viewer: { canManage: false },
      });
    });

    await page.goto(`${TEAM_SETTINGS_PATH}/keys`);
    const group = page.getByRole("radiogroup", {
      name: "Mogplex API key access for this team",
    });
    await expect(
      group.getByRole("radio", { name: /Automations only/ })
    ).toBeChecked();
    await expect(
      group.getByRole("radio", { name: /Each key's own access/ })
    ).toBeDisabled();
    await expect(
      page.getByText("Only a team owner can change it.", { exact: false })
    ).toBeVisible();
    expect(methods.every((method) => method === "GET")).toBe(true);
  });
}

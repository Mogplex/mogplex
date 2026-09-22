import {
  expect,
  fulfillJson,
  mockTeamSettings,
  TEAM_ENDPOINT,
  TEAM_SETTINGS_PATH,
  test,
} from "./helpers/run-checks-fixtures";

for (const role of ["owner", "admin"] as const) {
  test(`Team Models lets an ${role} save Run checks and retains the choice on reload`, async ({
    page,
  }) => {
    await mockTeamSettings(page, role);
    let enabled = true;
    const patches: unknown[] = [];
    await page.route(TEAM_ENDPOINT, async (route) => {
      if (route.request().method() === "PATCH") {
        const body = route.request().postDataJSON() as { enabled: boolean };
        patches.push(body);
        enabled = body.enabled;
      }
      await fulfillJson(route, { enabled, viewer: { canManage: true } });
    });

    await page.goto(TEAM_SETTINGS_PATH);
    await page.getByRole("tab", { name: "Models", exact: true }).click();
    await expect(page).toHaveURL(`${TEAM_SETTINGS_PATH}?tab=models`);
    const toggle = page.getByRole("switch", { name: "Run checks" });
    await expect(toggle).toBeChecked();
    await expect(toggle).toBeEnabled();
    await expect(
      page.getByText(
        "Applies to everyone's work in this team. Only an owner or admin can change it."
      )
    ).toBeVisible();
    await expect(
      page.getByText(/summaries of the skills available to it are sent/)
    ).toBeVisible();
    await expect(
      page.getByText(/When it is off, nothing is sent/)
    ).toBeVisible();

    await toggle.click();
    await expect(toggle).not.toBeChecked();
    expect(patches).toEqual([{ enabled: false }]);
    await page.reload();
    await expect(toggle).not.toBeChecked();
    await expect(toggle).toBeEnabled();
    await toggle.click();
    await expect(toggle).toBeChecked();
    expect(patches).toEqual([{ enabled: false }, { enabled: true }]);
  });
}

test("Team Run checks retains its saved value when a change fails", async ({
  page,
}) => {
  await mockTeamSettings(page);
  await page.route(TEAM_ENDPOINT, (route) =>
    route.request().method() === "PATCH"
      ? fulfillJson(route, { error: "Unable to save team run checks" }, 500)
      : fulfillJson(route, { enabled: true, viewer: { canManage: true } })
  );
  await page.goto(`${TEAM_SETTINGS_PATH}?tab=models`);
  const toggle = page.getByRole("switch", { name: "Run checks" });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(page.getByText("Unable to save team run checks")).toBeVisible();
  await expect(toggle).toBeChecked();
  await expect(toggle).toBeEnabled();
});

for (const role of ["developer", "viewer"] as const) {
  test(`Team Run checks is read-only for a ${role}`, async ({ page }) => {
    await mockTeamSettings(page, role);
    const methods: string[] = [];
    await page.route(TEAM_ENDPOINT, (route) => {
      methods.push(route.request().method());
      return fulfillJson(route, {
        enabled: true,
        viewer: { canManage: false },
      });
    });
    await page.goto(`${TEAM_SETTINGS_PATH}?tab=models`);
    const toggle = page.getByRole("switch", { name: "Run checks" });
    await expect(toggle).toBeChecked();
    await expect(toggle).toBeDisabled();
    expect(methods).toEqual(["GET"]);
  });
}

test("Team Run checks stays disabled when the setting cannot be loaded", async ({
  page,
}) => {
  await mockTeamSettings(page);
  await page.route(TEAM_ENDPOINT, (route) =>
    fulfillJson(route, { error: "Unavailable" }, 503)
  );
  await page.goto(`${TEAM_SETTINGS_PATH}?tab=models`);
  await expect(page.getByText("Unable to load this setting.")).toBeVisible();
  await expect(page.getByRole("switch", { name: "Run checks" })).toBeDisabled();
});

import {
  expect,
  fulfillJson,
  mockTeamSettings,
  TEAM,
  TEAM_SETTINGS_PATH,
  test,
} from "./helpers/run-checks-fixtures";

test("an owner saves domain joining, reloads it, and adds an existing teammate", async ({
  page,
}) => {
  await mockTeamSettings(page);
  let domain: string | null = null;
  let enabled = false;
  const additions: unknown[] = [];
  await page.route(`**/api/teams/${TEAM.id}/signup-domain`, async (route) => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON() as { enabled: boolean };
      enabled = body.enabled;
      domain = "example.com";
    }
    await fulfillJson(route, {
      domain,
      enabled,
      eligibleDomain: "example.com",
      viewer: { canManage: true },
    });
  });
  await page.route(`**/api/teams/${TEAM.id}/members/add`, async (route) => {
    additions.push(route.request().postDataJSON());
    await fulfillJson(
      route,
      { member: { userId: "person", role: "developer" } },
      201
    );
  });
  await page.goto(`${TEAM_SETTINGS_PATH}/members`);
  const toggle = page.getByRole("switch", {
    name: "Allow people from @example.com to join",
  });
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(toggle).toBeChecked();
  await page.reload();
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(
    page.getByText("Allow people from @example.com to join")
  ).toBeVisible();
  await toggle.click();
  await expect(toggle).toBeChecked();
  await page
    .getByLabel("Add someone who already signed up")
    .fill("person@example.com");
  await page.getByRole("button", { name: "Add member", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Member added with Developer access."
  );
  expect(additions).toEqual([
    { email: "person@example.com", role: "developer" },
  ]);
});

test("a failed save retains the domain setting and reports the error", async ({
  page,
}) => {
  await mockTeamSettings(page);
  await page.route(`**/api/teams/${TEAM.id}/signup-domain`, (route) =>
    route.request().method() === "PATCH"
      ? fulfillJson(route, { error: "Unable to save this setting." }, 500)
      : fulfillJson(route, {
          domain: null,
          enabled: false,
          eligibleDomain: "example.com",
          viewer: { canManage: true },
        })
  );
  await page.goto(`${TEAM_SETTINGS_PATH}/members`);
  const toggle = page.getByRole("switch", {
    name: "Allow people from @example.com to join",
  });
  await toggle.click();
  await expect(page.getByRole("status")).toHaveText(
    "Unable to save this setting."
  );
  await expect(toggle).not.toBeChecked();
});

test("a developer can read but cannot change the domain setting or add a member", async ({
  page,
}) => {
  await mockTeamSettings(page, "developer");
  await page.route(`**/api/teams/${TEAM.id}/signup-domain`, (route) =>
    fulfillJson(route, {
      domain: "example.com",
      enabled: true,
      eligibleDomain: "example.com",
      viewer: { canManage: false },
    })
  );
  await page.goto(`${TEAM_SETTINGS_PATH}/members`);
  await expect(
    page.getByRole("switch", { name: "Allow people from @example.com to join" })
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Add member", exact: true })
  ).toHaveCount(0);
});

test("a manager from another domain can turn joins off without changing the saved domain", async ({
  page,
}) => {
  await mockTeamSettings(page, "admin");
  let enabled = true;
  await page.route(`**/api/teams/${TEAM.id}/signup-domain`, async (route) => {
    if (route.request().method() === "PATCH") enabled = false;
    await fulfillJson(route, {
      domain: "example.com",
      enabled,
      eligibleDomain: "other.test",
      viewer: { canManage: true },
    });
  });
  await page.goto(`${TEAM_SETTINGS_PATH}/members`);
  const toggle = page.getByRole("switch", {
    name: "Allow people from @example.com to join",
  });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(toggle).toBeDisabled();
  await expect(
    page.getByText("Use a verified @example.com email to turn this on.")
  ).toBeVisible();
});

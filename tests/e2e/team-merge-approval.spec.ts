import {
  expect,
  mockTeamSettings,
  TEAM_SETTINGS_PATH,
  test,
} from "./helpers/run-checks-fixtures";

test("team members settings no longer show a second merge approval step", async ({
  page,
}) => {
  await mockTeamSettings(page);
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/agent-merges")) requests.push(request.url());
  });
  await page.goto(`${TEAM_SETTINGS_PATH}/members`);
  await expect(
    page.getByText("Let teammates join", { exact: true })
  ).toBeVisible();
  await expect(page.getByText("Agent merges", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("switch", { name: "Require merge approval" })
  ).toHaveCount(0);
  await expect(
    page.getByRole("switch", { name: "Merge only in the run's repository" })
  ).toHaveCount(0);
  expect(requests).toEqual([]);
});

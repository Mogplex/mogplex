import {
  expect,
  fulfillJson,
  mockTeamSettings,
  TEAM,
  TEAM_SETTINGS_PATH,
  test,
} from "./helpers/run-checks-fixtures";
import type { TeamMergePolicyResponse } from "@/lib/github-merge-policy-handlers";

const endpoint = `**/api/teams/${TEAM.id}/agent-merges`;
const initial: TeamMergePolicyResponse = {
  policy: { requireApproval: false, contextRepoOnly: false },
  approvals: [],
  viewer: { canManage: true },
};

test("owner opts into merge approval and context scope, and choices survive reload", async ({
  page,
}) => {
  await mockTeamSettings(page);
  let data = initial;
  const changes: unknown[] = [];
  await page.route(endpoint, (route) => {
    if (route.request().method() === "PATCH") {
      const policy = route
        .request()
        .postDataJSON() as TeamMergePolicyResponse["policy"];
      changes.push(policy);
      data = { ...data, policy };
    }
    return fulfillJson(route, data);
  });
  await page.goto(`${TEAM_SETTINGS_PATH}/members`);
  const approval = page.getByRole("switch", { name: "Require merge approval" });
  const scope = page.getByRole("switch", {
    name: "Merge only in the run's repository",
  });
  await expect(approval).not.toBeChecked();
  await expect(scope).not.toBeChecked();
  await approval.click();
  await expect(approval).toBeChecked();
  await scope.click();
  await expect(scope).toBeChecked();
  await page.reload();
  await expect(approval).toBeChecked();
  await expect(scope).toBeChecked();
  expect(changes).toEqual([
    { requireApproval: true, contextRepoOnly: false },
    { requireApproval: true, contextRepoOnly: true },
  ]);
});

test("developer can resolve their exact-head request but cannot change team controls", async ({
  page,
}) => {
  await mockTeamSettings(page, "developer");
  let data: TeamMergePolicyResponse = {
    policy: { requireApproval: true, contextRepoOnly: false },
    viewer: { canManage: false },
    approvals: [
      {
        id: "approval-1",
        target_owner: "acme",
        target_repo: "widgets",
        pr_number: 84,
        head_sha: "a".repeat(40),
        commit_title: "Fix regression",
        created_at: "2026-10-04T00:00:00Z",
      },
    ],
  };
  const decisions: unknown[] = [];
  await page.route(endpoint, (route) => fulfillJson(route, data));
  await page.route(`${endpoint}/approval-1`, (route) => {
    decisions.push(route.request().postDataJSON());
    data = { ...data, approvals: [] };
    return fulfillJson(route, { ok: true });
  });
  await page.goto(`${TEAM_SETTINGS_PATH}/members`);
  await expect(
    page.getByRole("switch", { name: "Require merge approval" })
  ).toBeDisabled();
  await expect(
    page.getByRole("switch", { name: "Merge only in the run's repository" })
  ).toBeDisabled();
  await expect(
    page.getByRole("link", { name: "acme/widgets #84" })
  ).toHaveAttribute("href", "https://github.com/acme/widgets/pull/84");
  await expect(page.getByText(`Head: ${"a".repeat(40)}`)).toBeVisible();
  await page
    .getByRole("button", { name: "Approve merge of acme/widgets #84" })
    .click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Approved. Ask your agent to continue." })
  ).toBeVisible();
  await expect(
    page.getByText("No merge requests need your approval.")
  ).toBeVisible();
  expect(decisions).toEqual([{ approved: true }]);
});

test("failed setting or approval writes keep the saved state and request visible", async ({
  page,
}) => {
  await mockTeamSettings(page);
  await page.route(endpoint, (route) =>
    route.request().method() === "PATCH"
      ? fulfillJson(
          route,
          { error: "Unable to save agent merge settings" },
          500
        )
      : fulfillJson(route, {
          ...initial,
          approvals: [
            {
              id: "approval-1",
              target_owner: "acme",
              target_repo: "widgets",
              pr_number: 84,
              head_sha: "a".repeat(40),
              commit_title: "",
              created_at: "2026-10-04T00:00:00Z",
            },
          ],
        })
  );
  await page.route(`${endpoint}/approval-1`, (route) =>
    fulfillJson(route, { error: "Unable to save merge approval" }, 500)
  );
  await page.goto(`${TEAM_SETTINGS_PATH}/members`);
  const approval = page.getByRole("switch", { name: "Require merge approval" });
  await approval.click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Unable to save agent merge settings" })
  ).toHaveText("Unable to save agent merge settings");
  await expect(approval).not.toBeChecked();
  const deny = page.getByRole("button", {
    name: "Deny merge of acme/widgets #84",
  });
  await deny.click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Unable to save merge approval" })
  ).toHaveText("Unable to save merge approval");
  await expect(deny).toBeEnabled();
});

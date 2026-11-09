import { expect, test } from "@playwright/test";
import { connected, dashboard } from "./helpers/repository-settings-fixtures";

test("owner headers show which automations run there and link to GitHub access settings", async ({
  page,
}) => {
  await dashboard(page);
  const group = (name: string) =>
    connected(page).getByRole("region", { name, exact: true });

  await expect(
    group("acme").getByRole("link", { name: "PR-Review" })
  ).toBeVisible();
  await expect(
    group("team").getByRole("link", { name: "PR-Review" })
  ).toBeVisible();
  await expect(
    group("alex").getByRole("link", { name: "PR-Review" })
  ).toHaveCount(0);
  await expect(
    group("alex").getByRole("link", { name: "Beta check" })
  ).toBeVisible();
  await expect(
    group("acme").getByRole("link", { name: "Beta check" })
  ).toHaveCount(0);

  const manage = group("acme").getByRole("link", {
    name: "Manage acme repository access on GitHub",
  });
  await expect(manage).toHaveAttribute(
    "href",
    "https://github.com/organizations/acme/settings/installations/12"
  );
  await expect(manage).toHaveAttribute("target", "_blank");
  await expect(
    group("team").getByRole("link", { name: /Manage team repository access/ })
  ).toHaveCount(0);
});

test("the toolbar shows when repositories were last synced and refreshes it after a sync", async ({
  page,
}) => {
  const { installationRequests } = await dashboard(page);
  await expect(page.getByText(/^Last synced \d+m ago$/)).toBeVisible();
  const before = installationRequests.count;
  await page.getByRole("button", { name: "Sync GitHub" }).click();
  await expect.poll(() => installationRequests.count).toBeGreaterThan(before);
});

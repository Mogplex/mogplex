import { expect, test } from "@playwright/test";
import { scopedPath } from "./helpers/auth";
import {
  createBillingState,
  installBaseMocks,
} from "./helpers/sandbox-billing-fixtures";

test("workspace and repo settings retire legacy personal Vercel configuration", async ({
  page,
}) => {
  const state = createBillingState({
    workspace: {
      sandbox_billing_mode: "user_vercel_project",
      sandbox_vercel_team_id: "team-acme",
      sandbox_vercel_project_id: "workspace-app",
    },
  });
  await installBaseMocks(page, state);
  const targetRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/vercel/targets")) {
      targetRequests.push(request.url());
    }
  });

  await page.goto(scopedPath("projects/repositories"));
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Manage" }).click();
  await page.getByText("Rename project").click();

  await expect(
    page.getByRole("combobox", { name: "Default Sandbox Billing" })
  ).toHaveValue("platform");
  await expect(
    page.getByRole("combobox", { name: "Workspace Vercel Project" })
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Save" }).click();
  expect(state.workspacePatchBodies.at(-1)).toMatchObject({
    sandbox_billing_mode: "platform",
    sandbox_vercel_team_id: null,
    sandbox_vercel_project_id: null,
  });

  await page.getByRole("button", { name: "Repo actions" }).click();
  await page.getByText("Space Settings").click();
  await expect(
    page.getByRole("combobox", { name: "Sandbox Billing" })
  ).toHaveValue("inherit");
  await expect(
    page.getByRole("combobox", { name: "Repo-linked Vercel Project" })
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Save Settings" }).click();
  expect(state.repoPatchBodies.at(-1)).toMatchObject({
    sandbox_billing_mode_override: null,
    sandbox_billing_target: "personal",
    vercel_team_id: null,
    vercel_project_id: null,
  });
  expect(targetRequests).toEqual([]);
});

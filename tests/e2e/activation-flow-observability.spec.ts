import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  connectedUser,
  initializeTrackedEvents,
  mockActivationFlow,
  secondaryRepo,
  syncedRepo,
} from "./helpers/activation-fixtures";
import { buildSandboxBackedCall } from "./helpers/sandbox-fixtures";

const workspacePath = `/${connectedUser.username}/projects/workspace`;

test("observability can open the matching sandbox health tab in the workspace", async ({
  page,
}) => {
  await initializeTrackedEvents(page);
  await enableScopedE2EAuth(page);

  const previewUrl = "http://127.0.0.1:3000/__e2e/preview/repo-1";

  const harness = await mockActivationFlow(page, {
    initialRepos: [syncedRepo],
    observabilityCalls: [
      buildSandboxBackedCall({
        repoId: "repo-1",
        sandboxRecordId: "sandbox-record-repo-1",
        sandboxId: "sandbox-runtime-repo-1",
        previewUrl,
        computeBillingSource: "user_vercel_project",
        billingProjectId: "proj_user_123",
        billingTeamId: "team-acme",
        aiBillingSource: "user_ai_gateway",
      }),
    ],
  });

  harness.seedSandbox("repo-1", {
    preview_url: previewUrl,
    billing_source: "user_vercel_project",
    billing_project_id: "proj_user_123",
    billing_team_id: "team-acme",
    vercel_project_id: "proj_user_123",
    vercel_team_id: "team-acme",
    health_status: "app_error",
    last_preview_http_status: 500,
    last_preview_error: "HTTP 500 at preview",
  });

  await page.goto(scopedPath("observability"));
  await page.waitForLoadState("networkidle");

  await page.getByRole("tab", { name: /^Activity/ }).click();
  const callsSection = page.getByRole("tabpanel");
  await callsSection.locator("tbody tr").first().click();
  await expect(
    callsSection.getByRole("button", { name: "Open sandbox health" })
  ).toBeEnabled();

  await callsSection
    .getByRole("button", { name: "Open sandbox health" })
    .click();

  await expect(page).toHaveURL(/\/projects\/workspace$/);
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Workspace Chat · demo-app")).toBeVisible();
  await expect(page.getByText("Sandbox Health")).toBeVisible();
  await expect(page.getByText("status: running")).toBeVisible();
  await expect(page.getByText("health: app_error")).toBeVisible();
  await expect(page.getByText("Your Vercel project")).toBeVisible();
  await expect(page.getByText("Project: proj_user_123")).toBeVisible();
  await expect(page.getByText("Team: team-acme")).toBeVisible();
  await expect(page.getByText("HTTP 500 at preview")).toBeVisible();
});

test("sandbox health can open exact sandbox-scoped observability calls", async ({
  page,
}) => {
  await initializeTrackedEvents(page);
  await enableScopedE2EAuth(page);

  const previewUrl = "http://127.0.0.1:3000/__e2e/preview/repo-1";
  const secondaryPreviewUrl = "http://127.0.0.1:3000/__e2e/preview/repo-2";

  const harness = await mockActivationFlow(page, {
    initialRepos: [syncedRepo, secondaryRepo],
    observabilityCalls: [
      buildSandboxBackedCall({
        repoId: "repo-1",
        sandboxRecordId: "sandbox-record-repo-1",
        sandboxId: "sandbox-runtime-repo-1",
        previewUrl,
        computeBillingSource: "user_vercel_project",
        billingProjectId: "proj_user_123",
        billingTeamId: "team-acme",
        aiBillingSource: "user_ai_gateway",
        model: "anthropic/claude-sonnet-4",
      }),
      buildSandboxBackedCall({
        repoId: "repo-1",
        sandboxRecordId: "sandbox-record-repo-1b",
        sandboxId: "sandbox-runtime-repo-1b",
        previewUrl,
        computeBillingSource: "user_vercel_project",
        billingProjectId: "proj_user_456",
        billingTeamId: "team-acme",
        aiBillingSource: "user_ai_gateway",
        callId: "call-1b",
        model: "openai/gpt-5-mini",
      }),
      buildSandboxBackedCall({
        repoId: "repo-2",
        sandboxRecordId: "sandbox-record-repo-2",
        sandboxId: "sandbox-runtime-repo-2",
        previewUrl: secondaryPreviewUrl,
        computeBillingSource: "platform",
        billingProjectId: null,
        billingTeamId: null,
        aiBillingSource: "platform_ai_gateway",
        callId: "call-2",
        model: "openai/gpt-5",
      }),
    ],
  });

  harness.seedSandbox("repo-1", {
    preview_url: previewUrl,
    billing_source: "user_vercel_project",
    billing_project_id: "proj_user_123",
    billing_team_id: "team-acme",
    vercel_project_id: "proj_user_123",
    vercel_team_id: "team-acme",
    health_status: "app_error",
    last_preview_http_status: 500,
    last_preview_error: "HTTP 500 at preview",
  });

  await page.goto(workspacePath);
  await page.waitForLoadState("networkidle");
  await page.getByTestId("home-open-workspace-repo-1").click();
  await page.getByRole("button", { name: "Health", exact: true }).click();

  await expect(page.getByText("Sandbox Health")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open in Observability" })
  ).toBeVisible();
  await page.getByRole("button", { name: "Open in Observability" }).click();

  await expect(page).toHaveURL(
    /\/observability\?repo_id=repo-1&sandbox_record_id=sandbox-record-repo-1/
  );
  await page.waitForLoadState("networkidle");

  // Repo/sandbox filters arrive via the URL, which lands the page on the
  // Activity tab of the table tab group with the matching call row
  // auto-expanded.
  await expect(page.getByRole("tab", { name: /^Activity/ })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  const callsSection = page.getByRole("tabpanel");
  await expect(callsSection.getByText("claude-sonnet-4")).toBeVisible();
  await expect(callsSection.getByText("gpt-5-mini")).toHaveCount(0);
  await expect(callsSection.getByText(/^gpt-5$/)).toHaveCount(0);
  await expect(callsSection.getByText("Sandbox Billing")).toBeVisible();
  await expect(
    callsSection.getByRole("button", { name: "Open sandbox health" })
  ).toBeVisible();
  await expect(
    callsSection.getByText("sandbox-record-repo-1", { exact: true })
  ).toBeVisible();
  await expect(callsSection.getByText("proj_user_123")).toBeVisible();

  // The exact-call scoping survives a reload: the URL still carries the
  // repo/sandbox params and the matching row re-expands.
  await page.reload();
  await page.waitForLoadState("networkidle");

  await expect(page).toHaveURL(
    /\/observability\?repo_id=repo-1&sandbox_record_id=sandbox-record-repo-1/
  );
  const reloadedCallsSection = page.getByRole("tabpanel");
  await expect(reloadedCallsSection.getByText("claude-sonnet-4")).toBeVisible();
  await expect(reloadedCallsSection.getByText("gpt-5-mini")).toHaveCount(0);
  await expect(reloadedCallsSection.getByText("Sandbox Billing")).toBeVisible();
  await expect(
    reloadedCallsSection.getByText("sandbox-record-repo-1", { exact: true })
  ).toBeVisible();
});

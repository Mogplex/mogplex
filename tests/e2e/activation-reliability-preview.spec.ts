import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  connectedUser,
  initializeTrackedEvents,
  mockActivationFlow,
  mockProjectsDashboard,
  syncedRepo,
} from "./helpers/activation-fixtures";
import {
  buildSandboxBackedCall,
  buildSandboxSummaries,
} from "./helpers/sandbox-fixtures";

test("preview app errors surface recovery UI and clear live chrome", async ({
  page,
}) => {
  await initializeTrackedEvents(page);
  await enableScopedE2EAuth(page);
  const harness = await mockActivationFlow(page);

  await page.goto(scopedPath("projects/workspace"));
  await page.waitForLoadState("networkidle");
  await page.getByTestId("home-sync-repos").click();
  await page.getByTestId("home-open-workspace-repo-1").click();

  const readyBadges = page.getByText("ready", { exact: true });
  await expect(readyBadges.first()).toBeVisible();

  harness.setSandboxState("repo-1", {
    status: "running",
    health_status: "app_error",
    last_preview_http_status: 500,
    last_preview_error: "HTTP 500 at preview",
  });

  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
  });

  await expect(
    page.getByText("Preview returned an application error")
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Restart preview" })
  ).toBeVisible();
  await expect(readyBadges).toHaveCount(0);
});

test("preview build failures surface Vercel deployment diagnostics in preview and health", async ({
  page,
}) => {
  await initializeTrackedEvents(page);
  await enableScopedE2EAuth(page);
  const harness = await mockActivationFlow(page);

  await page.goto(scopedPath("projects/workspace"));
  await page.waitForLoadState("networkidle");
  await page.getByTestId("home-sync-repos").click();
  await page.getByTestId("home-open-workspace-repo-1").click();

  harness.setSandboxState("repo-1", {
    status: "running",
    health_status: "app_error",
    last_preview_http_status: 503,
    last_preview_error: "Service unavailable while deployment booted",
    vercel_diagnostics: {
      state: "build_failed",
      deploymentId: "dpl_build_fail",
      deploymentUrl: "https://failed-app.vercel.app",
      deploymentStatus: "ERROR",
      buildSummary: "Error: Missing NEXT_PUBLIC_API_URL",
      detectedAt: "2026-04-01T12:05:00.000Z",
    },
  });

  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
  });

  await expect(
    page.getByText("Latest Vercel deployment failed to build")
  ).toBeVisible();
  await expect(
    page.getByText("Error: Missing NEXT_PUBLIC_API_URL")
  ).toBeVisible();

  await page.getByRole("button", { name: "Open health" }).click();
  await expect(page.getByText("Vercel Diagnostics")).toBeVisible();
  await expect(page.getByText("Build failed")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "open deployment" })
  ).toHaveAttribute("href", "https://failed-app.vercel.app");
});

test("preview building state surfaces Vercel deployment progress", async ({
  page,
}) => {
  await initializeTrackedEvents(page);
  await enableScopedE2EAuth(page);
  const harness = await mockActivationFlow(page);

  await page.goto(scopedPath("projects/workspace"));
  await page.waitForLoadState("networkidle");
  await page.getByTestId("home-sync-repos").click();
  await page.getByTestId("home-open-workspace-repo-1").click();

  harness.setSandboxState("repo-1", {
    status: "running",
    health_status: "starting",
    last_preview_http_status: 503,
    last_preview_error: "Preview is still starting",
    vercel_diagnostics: {
      state: "building",
      deploymentId: "dpl_building",
      deploymentUrl: "https://building-app.vercel.app",
      deploymentStatus: "BUILDING",
      buildSummary: "Queued on build machine",
      detectedAt: "2026-04-01T12:05:00.000Z",
    },
  });

  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
  });

  await expect(
    page.getByText("Vercel deployment is still building")
  ).toBeVisible();
  await expect(page.getByText("Queued on build machine")).toBeVisible();
});

test("running VM with a non-listening dev server labels the chip as starting", async ({
  page,
}) => {
  await initializeTrackedEvents(page);
  await enableScopedE2EAuth(page);
  const harness = await mockActivationFlow(page);

  await page.goto(scopedPath("projects/workspace"));
  await page.waitForLoadState("networkidle");
  await page.getByTestId("home-sync-repos").click();
  await page.getByTestId("home-open-workspace-repo-1").click();

  const readyBadges = page.getByText("ready", { exact: true });
  await expect(readyBadges.first()).toBeVisible();

  harness.setSandboxState("repo-1", {
    status: "running",
    health_status: "starting",
    last_preview_http_status: 502,
    last_preview_error: "SANDBOX_NOT_LISTENING",
  });

  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
  });

  await expect(page.getByText("starting dev server").first()).toBeVisible();
  await expect(readyBadges).toHaveCount(0);
  await expect(page.getByText(/sandbox live/i)).toHaveCount(0);
});

test("user-billed sandbox errors stay aligned across preview, health, and observability", async ({
  page,
}) => {
  await initializeTrackedEvents(page);
  await enableScopedE2EAuth(page);

  const previewUrl = "http://127.0.0.1:3000/__e2e/preview/repo-1";

  const harness = await mockActivationFlow(page, {
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

  await page.goto(scopedPath("projects/workspace"));
  await page.waitForLoadState("networkidle");
  await page.getByTestId("home-sync-repos").click();
  await page.getByTestId("home-open-workspace-repo-1").click();

  await expect(
    page.getByText("Preview returned an application error")
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Restart preview" })
  ).toBeVisible();
  await page.getByRole("button", { name: "Open health" }).click();

  await expect(page.getByText("Sandbox Health")).toBeVisible();
  await expect(page.getByText("status: running")).toBeVisible();
  await expect(page.getByText("health: app_error")).toBeVisible();
  await expect(page.getByText("preview: HTTP 500")).toBeVisible();
  await expect(page.getByText("Your Vercel project")).toBeVisible();
  await expect(page.getByText("Project: proj_user_123")).toBeVisible();
  await expect(page.getByText("Team: team-acme")).toBeVisible();
  await expect(page.getByText("HTTP 500 at preview")).toBeVisible();

  await page.goto(scopedPath("observability"));
  await page.waitForLoadState("networkidle");

  await expect(
    page.getByRole("heading", { name: "Observability" })
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();

  const callsSection = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Activity" }) });
  await callsSection.locator("tbody tr").first().click();

  await expect(callsSection.getByText("Sandbox Billing")).toBeVisible();
  await expect(callsSection.getByText("Compute Billing")).toBeVisible();
  await expect(callsSection.getByText("user billing")).toBeVisible();
  await expect(callsSection.getByText("AI Billing Source")).toBeVisible();
  await expect(callsSection.getByText("user ai gateway")).toBeVisible();
  await expect(callsSection.getByText("proj_user_123")).toBeVisible();
  await expect(callsSection.getByText("team-acme")).toBeVisible();
  await expect(
    callsSection.getByText("sandbox-record-repo-1", { exact: true })
  ).toBeVisible();
  await expect(
    callsSection.getByText("sandbox-runtime-repo-1", { exact: true })
  ).toBeVisible();
});

test("preview unreachable state surfaces warning UI and clears live chrome", async ({
  page,
}) => {
  await initializeTrackedEvents(page);
  await enableScopedE2EAuth(page);
  const harness = await mockActivationFlow(page);

  await page.goto(scopedPath("projects/workspace"));
  await page.waitForLoadState("networkidle");
  await page.getByTestId("home-sync-repos").click();
  await page.getByTestId("home-open-workspace-repo-1").click();

  const readyBadges = page.getByText("ready", { exact: true });
  await expect(readyBadges.first()).toBeVisible();

  harness.setSandboxState("repo-1", {
    status: "running",
    health_status: "unreachable",
    last_preview_error: "Connection refused at preview",
  });

  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
  });

  await expect(page.getByText("Preview is unreachable")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Restart preview" })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Open health" })).toBeVisible();
  await expect(readyBadges).toHaveCount(0);
});

test("idle-warning state stays behind a stable ready state", async ({
  page,
}) => {
  await initializeTrackedEvents(page);
  await enableScopedE2EAuth(page);
  const sandbox = {
    id: "sandbox-record-repo-1",
    sandbox_id: "sandbox-runtime-repo-1",
    repo_id: "repo-1",
    status: "running",
    created_at: new Date().toISOString(),
    last_active_at: new Date().toISOString(),
    preview_url: "http://127.0.0.1:3000/__e2e/preview/repo-1",
    health_status: "idle_warning",
    last_preview_http_status: 200,
    last_preview_error: null,
    last_boot_error: null,
    boot_attempts: 1,
  };
  Object.assign(sandbox, buildSandboxSummaries(sandbox));

  await mockProjectsDashboard(page, {
    user: connectedUser,
    repos: [syncedRepo],
    sandboxes: [sandbox],
  });

  await page.goto(scopedPath("projects/repositories"));
  await page.waitForLoadState("networkidle");

  await expect(page.getByText("Ready", { exact: true })).toBeVisible();
  await expect(page.getByText(/idle soon|\d+m left/i)).toHaveCount(0);
});

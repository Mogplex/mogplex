import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  connectedUser,
  disconnectedGithubUser,
  initializeTrackedEvents,
  mockActivationFlow,
  mockHomeState,
  mockProjectsDashboard,
  syncedRepo,
} from "./helpers/activation-fixtures";
import {
  buildSandboxBackedCall,
  buildSandboxSummaries,
} from "./helpers/sandbox-fixtures";

const installPendingUser = {
  ...disconnectedGithubUser,
  github_app_available: true,
  github_state: "app_install_pending" as const,
  github_status_label: "Install pending",
  github_status_detail:
    "Finish the GitHub App install in GitHub. Mogplex will pick up the installation and sync coverage.",
  github_primary_action: {
    kind: "complete_install" as const,
    label: "Complete GitHub App install",
    href: "/api/auth/github",
  },
  github_install_pending: true,
  github_installation_count: 0,
  github_synced_repo_count: 0,
};

const oauthInstallPendingUser = {
  ...connectedUser,
  github_app_available: true,
  github_state: "app_install_pending" as const,
  github_status_label: "Install pending",
  github_status_detail:
    "Finish the GitHub App install in GitHub. Mogplex will pick up the installation and sync coverage.",
  github_primary_action: {
    kind: "complete_install" as const,
    label: "Complete GitHub App install",
    href: "/api/auth/github",
  },
  github_install_pending: true,
  github_installation_count: 0,
  github_synced_repo_count: 0,
};

test("home prioritizes opening a workspace when repos already exist, even if GitHub is currently disconnected", async ({
  page,
}) => {
  await initializeTrackedEvents(page);
  await enableScopedE2EAuth(page);
  await mockHomeState(page, {
    user: disconnectedGithubUser,
    repos: [syncedRepo],
  });

  await page.goto(scopedPath("projects/workspace"));

  await expect(
    page.getByText("Open Workspace is the main action.")
  ).toBeVisible();
  await expect(page.getByTestId("home-open-workspace-repo-1")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Connect GitHub" })
  ).toHaveCount(0);
  await expect(page.getByText("next: Open a workspace")).toBeVisible();
});

test("home setup guide shows complete-install action when GitHub App install is pending", async ({
  page,
}) => {
  await initializeTrackedEvents(page);
  await enableScopedE2EAuth(page);
  await mockHomeState(page, {
    user: oauthInstallPendingUser,
    repos: [],
  });

  await page.goto(scopedPath("projects/workspace"));
  await page.waitForLoadState("networkidle");

  await expect(
    page.getByText(
      "Finish the GitHub App install in GitHub. Mogplex will pick up the installation and sync coverage."
    )
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Complete GitHub App install" }).first()
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Sync repos" })).toBeVisible();
});

test("home sync failure surfaces retry guidance", async ({ page }) => {
  await initializeTrackedEvents(page);
  await enableScopedE2EAuth(page);
  await mockHomeState(page, {
    user: connectedUser,
    repos: [],
    githubSyncResponse: {
      ok: false,
      status: 500,
      error: "GITHUB_SYNC_ERROR",
    },
  });

  await page.goto(scopedPath("projects/workspace"));
  await page.waitForLoadState("networkidle");
  await page.getByTestId("home-sync-repos").click();

  await expect(
    page.getByText("GitHub repo sync failed. Retry sync.")
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Import spaces" })
  ).toBeVisible();
});

test("home surfaces repo load failures without crashing the shell", async ({
  page,
}) => {
  await initializeTrackedEvents(page);
  await enableScopedE2EAuth(page);
  await mockHomeState(page, {
    user: connectedUser,
    repos: [],
    reposError: {
      status: 500,
      error: "Failed to load repos",
    },
  });

  await page.goto(scopedPath("projects/workspace"));
  await page.waitForLoadState("networkidle");

  await expect(page.getByText("Failed to load repos")).toBeVisible();
  await expect(
    page.getByText("First successful action: open a workspace.")
  ).toBeVisible();
  await expect(page.getByText("next: Sync spaces")).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
});

test("projects empty state prioritizes completing the GitHub App install over importing repos", async ({
  page,
}) => {
  await initializeTrackedEvents(page);
  await enableScopedE2EAuth(page);
  await mockProjectsDashboard(page, {
    user: installPendingUser,
    repos: [],
    sandboxes: [],
    workspaces: [],
  });

  await page.goto(scopedPath("projects/repositories"));
  await page.waitForLoadState("networkidle");

  await expect(
    page.getByText(
      "Finish the GitHub App install, then create your first project."
    )
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Complete GitHub App install" }).first()
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Import repositories" })
  ).toHaveCount(0);
});

test("projects empty state allows importing repos when OAuth is connected but app install is pending", async ({
  page,
}) => {
  await initializeTrackedEvents(page);
  await enableScopedE2EAuth(page);
  await mockProjectsDashboard(page, {
    user: oauthInstallPendingUser,
    repos: [],
    sandboxes: [],
    workspaces: [],
  });

  await page.goto(scopedPath("projects/repositories"));
  await page.waitForLoadState("networkidle");

  await expect(
    page.getByText(
      "GitHub is connected. Import repos now, then finish the GitHub App install for trigger coverage."
    )
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Import repositories" })
  ).toBeVisible();
});

test("projects dashboard surfaces data-load failures instead of empty onboarding when synced spaces exist", async ({
  page,
}) => {
  await initializeTrackedEvents(page);
  await enableScopedE2EAuth(page);
  await mockProjectsDashboard(page, {
    user: {
      ...connectedUser,
      github_app_available: true,
      github_app_connected: true,
      github_connection_mode: "app",
      github_state: "app_installed_with_synced_repos",
      github_status_label: "Ready",
      github_status_detail:
        "GitHub App coverage is active and synced repos are available in Spaces.",
      github_primary_action: null,
      github_installation_count: 1,
      github_synced_repo_count: 142,
    },
    repos: [],
    sandboxes: [],
    workspaces: [],
    reposError: {
      status: 500,
      error: "Failed to load spaces",
    },
  });

  await page.goto(scopedPath("projects/repositories"));
  await page.waitForLoadState("networkidle");

  await expect(
    page.getByText("Failed to load projects and spaces.")
  ).toBeVisible();
  await expect(page.getByText("Failed to load spaces")).toBeVisible();
  await expect(page.getByText("142 synced spaces")).toBeVisible();
  await expect(page.getByText("Create your first project.")).toHaveCount(0);
  await expect(
    page.getByText("GitHub repo sync failed. Retry sync.")
  ).toHaveCount(0);
});

test("sandbox stop reconciles preview and chrome without stale live state", async ({
  page,
}) => {
  await initializeTrackedEvents(page);
  await enableScopedE2EAuth(page);
  await mockActivationFlow(page);

  await page.goto(scopedPath("projects/workspace"));
  await page.waitForLoadState("networkidle");
  await page.getByTestId("home-sync-repos").click();
  await page.getByTestId("home-open-workspace-repo-1").click();

  const readyBadges = page.getByText("ready", { exact: true });
  await expect(readyBadges.first()).toBeVisible();
  await expect(page.getByText(/\d+m left/i)).toHaveCount(0);

  await page.getByRole("button", { name: "Health", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Stop environment" })
  ).toBeVisible();

  const stopResponse = page.waitForResponse(
    (response) =>
      /\/api(?:\/sandbox){2}-record-repo-1\/stop$/.test(response.url()) &&
      response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Stop environment" }).click();
  await stopResponse;

  await page.getByRole("button", { name: "Preview", exact: true }).click();
  const stoppedChip = page
    .locator("span.inline-flex")
    .filter({ hasText: /^stopped$/ })
    .first();
  await expect(stoppedChip).toBeVisible();
  await expect(stoppedChip).toHaveText("stopped");
  await expect(readyBadges).toHaveCount(0);

  // PR6: stopped overlay exposes both restart-on-branch and start-fresh.
  await expect(
    page.getByRole("button", { name: "Restart on this branch" })
  ).toBeVisible();
  const startFresh = page.getByRole("button", { name: /Start fresh/ });
  await expect(startFresh).toBeVisible();
  await startFresh.click();
  await expect(
    page.getByRole("dialog").getByText("Start a new sandbox")
  ).toBeVisible();
});

test("fresh Start fresh failures from the stopped overlay render inline", async ({
  page,
}) => {
  await initializeTrackedEvents(page);
  await enableScopedE2EAuth(page);
  const harness = await mockActivationFlow(page);

  await page.goto(scopedPath("projects/workspace"));
  await page.waitForLoadState("networkidle");
  await page.getByTestId("home-sync-repos").click();
  await page.getByTestId("home-open-workspace-repo-1").click();

  await expect(page.getByText("ready", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Health", exact: true }).click();

  const stopResponse = page.waitForResponse(
    (response) =>
      /\/api(?:\/sandbox){2}-record-repo-1\/stop$/.test(response.url()) &&
      response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Stop environment" }).click();
  await stopResponse;

  await page.getByRole("button", { name: "Preview", exact: true }).click();
  const previewStage = page.getByTestId("preview-stage");
  await expect(
    previewStage.getByRole("button", { name: "Restart on this branch" })
  ).toBeVisible();

  harness.setSandboxLaunchError({
    error: "Fresh stopped-overlay launch failed",
    status: 500,
  });

  await previewStage.getByRole("button", { name: /Start fresh/ }).click();
  const launchDialog = page.getByRole("dialog");
  await expect(launchDialog).toBeVisible();
  await launchDialog.getByRole("button", { name: "Start Sandbox" }).click();

  await expect(previewStage.getByText("Sandbox launch failed")).toBeVisible();
  await expect(
    previewStage.getByText("Fresh stopped-overlay launch failed")
  ).toBeVisible();
});

test("session overflow menu offers a Start fresh sandbox affordance", async ({
  page,
}) => {
  await initializeTrackedEvents(page);
  await enableScopedE2EAuth(page);
  await mockActivationFlow(page);

  await page.goto(scopedPath("projects/workspace"));
  await page.waitForLoadState("networkidle");
  await page.getByTestId("home-sync-repos").click();
  await page.getByTestId("home-open-workspace-repo-1").click();

  await expect(page.getByText("ready", { exact: true }).first()).toBeVisible();

  await page.getByTestId("session-tab-1").click({
    button: "right",
  });
  await page.getByRole("menuitem", { name: "Start fresh sandbox…" }).click();

  await expect(
    page.getByRole("dialog").getByText("Start a new sandbox")
  ).toBeVisible();
});

test("server-side sandbox stops propagate on health reconciliation", async ({
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
  await expect(page.getByText(/\d+m left/i)).toHaveCount(0);

  harness.setSandboxState("repo-1", {
    status: "stopped",
    health_status: "stopped",
  });

  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
  });

  await expect(
    page.getByText("stopped", { exact: true }).first()
  ).toBeVisible();
  await expect(readyBadges).toHaveCount(0);
});

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

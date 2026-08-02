import { expect, test } from "@playwright/test";
import { enableE2EAuth } from "./helpers/auth";
import {
  connectedUser,
  disconnectedGithubUser,
  getTrackedEvents,
  initializeTrackedEvents,
  mockActivationFlow,
  mockHomeState,
  mockSettingsPage,
  secondaryRepo,
  syncedRepo,
  waitForTrackedEvent,
} from "./helpers/activation-fixtures";
import { buildSandboxBackedCall } from "./helpers/sandbox-fixtures";

const workspacePath = `/${connectedUser.username}/projects/workspace`;

test("public landing shows the agentic CI/CD hero and primary CTA", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  await expect(page.getByTestId("landing-hero")).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: /The pipeline\s*that ships itself\./,
    })
  ).toBeVisible();
  await expect(page.getByTestId("landing-request-access-link")).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: /Build it\. Watch it run\. Step in when it matters\./,
    })
  ).toBeVisible();

  await expect
    .poll(() => page.evaluate(() => document.fonts.check("44px Mondwest")))
    .toBe(true);
  const headingFamilies = await page
    .locator(".mlp h1, .mlp h2, .mlp h3")
    .evaluateAll((headings) =>
      headings.map((heading) => getComputedStyle(heading).fontFamily)
    );
  expect(headingFamilies.length).toBeGreaterThan(0);
  for (const fontFamily of headingFamilies) {
    expect(fontFamily).toContain("Mondwest");
  }
});

test("login page shows the waitlist gate form ready for input", async ({
  page,
}) => {
  await page.goto("/login");
  await page.waitForLoadState("networkidle");

  await expect(page.getByTestId("waitlist-gate-form")).toBeVisible();
  await expect(page.getByTestId("waitlist-code-input")).toBeVisible();
  await expect(page.getByTestId("login-github-button")).toHaveAttribute(
    "data-ready",
    "true"
  );
});

test("login CTA tracks login_started after the waitlist code is validated", async ({
  page,
}) => {
  await initializeTrackedEvents(page);

  // Stub a successful validation so the submit handler proceeds to track and
  // would otherwise navigate to /api/auth/login/github.
  await page.route("**/api/auth/waitlist/validate", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });
  // Catch the GitHub-init navigation so we don't actually leave the page.
  await page.route("**/api/auth/login/github*", async (route) => {
    await route.fulfill({ status: 204, body: "" });
  });

  await page.goto("/login");
  await page.waitForLoadState("networkidle");

  await page.getByTestId("waitlist-code-input").fill("e2e-test-code");
  await page.getByTestId("login-github-button").click();

  await waitForTrackedEvent(page, "login_started");
  const events = await getTrackedEvents(page);
  expect(events).toContainEqual(
    expect.objectContaining({
      name: "login_started",
      properties: expect.objectContaining({
        source: "login_page",
        provider: "github",
      }),
    })
  );
});

test("login landing surfaces session-expired notice", async ({ page }) => {
  await page.goto(
    "/login?expired=true&next=%2Fcli-auth%3Fcallback%3Dhttp%253A%252F%252Flocalhost%253A45454%252Fcallback"
  );
  await page.waitForLoadState("networkidle");

  await expect(page.getByText("session expired")).toBeVisible();
  // The GitHub button is now a form submit inside WaitlistGateForm rather than
  // an anchor — the next-path is preserved on the cookie set by the validate
  // call, not on the button's href.
  await expect(page.getByTestId("waitlist-gate-form")).toBeVisible();
});

test("settings GitHub CTA tracks github_connect_started", async ({ page }) => {
  await initializeTrackedEvents(page);
  await enableE2EAuth(page);
  await mockSettingsPage(page, disconnectedGithubUser);
  await page.goto("/settings");
  await page.waitForLoadState("networkidle");

  await expect(page.getByTestId("settings-github-connect")).toBeVisible();
  await page.getByTestId("settings-github-connect").evaluate((element) => {
    element.addEventListener("click", (event) => event.preventDefault(), {
      once: true,
    });
  });

  await page.getByTestId("settings-github-connect").dispatchEvent("click");

  await waitForTrackedEvent(page, "github_connect_started");
  const events = await getTrackedEvents(page);
  expect(events).toContainEqual(
    expect.objectContaining({
      name: "github_connect_started",
      properties: expect.objectContaining({
        source: "settings_github_card",
        connection_mode: "oauth",
      }),
    })
  );
});

test("home setup GitHub CTA tracks github_connect_started", async ({
  page,
}) => {
  await initializeTrackedEvents(page);
  await enableE2EAuth(page);
  await mockHomeState(page, {
    user: disconnectedGithubUser,
    repos: [],
  });
  await page.route("**/api/auth/github", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><html><body>ok</body></html>",
    });
  });
  await page.goto(workspacePath);
  await page.waitForLoadState("networkidle");

  await expect(
    page.getByRole("button", { name: "Connect GitHub" }).first()
  ).toBeVisible();

  await Promise.all([
    page.waitForURL("**/api/auth/github"),
    page.getByRole("button", { name: "Connect GitHub" }).first().click(),
  ]);

  const events = await getTrackedEvents(page);
  expect(events).toContainEqual(
    expect.objectContaining({
      name: "github_connect_started",
      properties: expect.objectContaining({
        source: "home_setup",
        connection_mode: "oauth",
      }),
    })
  );
});

test("activation flow tracks repo sync, preview start, workspace open, and preview feedback", async ({
  page,
}) => {
  await initializeTrackedEvents(page);
  await enableE2EAuth(page);
  const harness = await mockActivationFlow(page);

  await page.goto(workspacePath);
  await page.waitForLoadState("networkidle");

  await expect(page.getByTestId("home-sync-repos")).toBeVisible();
  await page.getByTestId("home-sync-repos").click();

  await expect(page.getByTestId("home-open-workspace-repo-1")).toBeVisible();

  await waitForTrackedEvent(page, "repo_sync_completed");
  let events = await getTrackedEvents(page);
  expect(events).toContainEqual(
    expect.objectContaining({
      name: "repo_sync_started",
      properties: expect.objectContaining({ source: "home_setup" }),
    })
  );
  expect(events).toContainEqual(
    expect.objectContaining({
      name: "repo_sync_completed",
      properties: expect.objectContaining({
        source: "home_setup",
        repo_count: 1,
      }),
    })
  );

  await page.getByTestId("home-open-workspace-repo-1").click();
  await waitForTrackedEvent(page, "preview_started");
  await waitForTrackedEvent(page, "workspace_opened");
  events = await getTrackedEvents(page);
  expect(events).toContainEqual(
    expect.objectContaining({
      name: "preview_started",
      properties: expect.objectContaining({
        source: "home_pane",
        trigger: "open_workspace",
        repo_id: "repo-1",
      }),
    })
  );
  expect(harness.getSandboxLaunchRequests()).toBe(1);
  await expect(page.getByTestId("preview-grab-button")).toBeVisible();
  await expect(page.getByTestId("preview-grab-button")).toBeEnabled();

  events = await getTrackedEvents(page);
  expect(events).toContainEqual(
    expect.objectContaining({
      name: "workspace_opened",
      properties: expect.objectContaining({
        source: "home_pane",
        repo_id: "repo-1",
        preview_state: "launch_requested",
      }),
    })
  );

  await page.getByTestId("preview-grab-button").click();

  const previewStage = page.getByTestId("preview-stage");
  const box = await previewStage.boundingBox();
  if (!box) {
    throw new Error("Preview stage was not visible");
  }

  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.5, {
    steps: 12,
  });
  await page.mouse.up();

  await expect(page.getByTestId("preview-feedback-input")).toBeVisible();
  await page
    .getByTestId("preview-feedback-input")
    .fill("Make the header clearer and tighten the hero spacing.");

  const chatRequest = page.waitForRequest("**/api/chat");
  await page.getByTestId("preview-feedback-send").click();
  await chatRequest;

  const chatBody = harness.getLastChatBody();
  expect(JSON.stringify(chatBody)).toContain("[Preview feedback —");
  expect(JSON.stringify(chatBody)).toContain(
    "Make the header clearer and tighten the hero spacing."
  );
  expect(chatBody).toEqual(
    expect.objectContaining({
      conversationId: expect.any(String),
      repoId: "repo-1",
      repoFullName: "acme/demo-app",
      repoOwner: "acme",
      repoName: "demo-app",
      repoBranch: "main",
    })
  );

  await waitForTrackedEvent(page, "preview_feedback_sent");
  events = await getTrackedEvents(page);
  expect(events).toContainEqual(
    expect.objectContaining({
      name: "preview_feedback_sent",
      properties: expect.objectContaining({
        source: "preview_pane",
      }),
    })
  );
});

test("workspace bootstrap shows default panes and pane add/close works", async ({
  page,
}) => {
  await initializeTrackedEvents(page);
  await enableE2EAuth(page);
  await mockActivationFlow(page);

  await page.goto(workspacePath);
  await page.waitForLoadState("networkidle");
  await page.getByTestId("home-sync-repos").click();
  await page.getByTestId("home-open-workspace-repo-1").click();

  await expect(page.getByText("Workspace Chat · demo-app")).toBeVisible();
  await expect(page.getByText("Live Preview")).toBeVisible();
  await expect(page.getByText("Terminal")).toBeVisible();
  await expect(page.getByText("Terminal Ready")).toBeVisible();
  await expect(page.getByTestId("preview-grab-button")).toBeEnabled();
  await expect(page.getByText("panes: 3")).toBeVisible();

  const agentPane = page.locator('[data-pane-type="agent"]').first();
  await agentPane.getByTitle("Add pane").click();
  await page.getByRole("menuitem", { name: "Files" }).click();

  await expect(page.getByText("panes: 4")).toBeVisible();
  const filesPane = page.locator('[data-pane-type="files"]').last();
  await expect(filesPane.getByText("package.json")).toBeVisible();

  await filesPane.getByTitle("Close pane").click();

  await expect(page.getByText("panes: 3")).toBeVisible();
  await expect(page.locator('[data-pane-type="files"]')).toHaveCount(0);
});

test("workspace chat conversation persists after reload", async ({ page }) => {
  await initializeTrackedEvents(page);
  await enableE2EAuth(page);
  await mockActivationFlow(page);

  await page.goto(workspacePath);
  await page.waitForLoadState("networkidle");
  await page.getByTestId("home-sync-repos").click();
  await page.getByTestId("home-open-workspace-repo-1").click();

  const prompt = "remember this workspace message";
  const saveResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/conversations") &&
      response.request().method() === "PUT" &&
      (response.request().postData() || "").includes(prompt)
  );

  await page
    .getByRole("textbox", {
      name: "Ask the agent what to build, fix, or explain. Type / for commands or drop files here.",
    })
    .fill(prompt);
  await page.keyboard.press("Enter");

  await expect(page.getByText("Applied preview feedback.")).toBeVisible();
  await saveResponse;

  await page.reload();
  await page.waitForLoadState("networkidle");

  if ((await page.getByText("Workspace Chat · demo-app").count()) === 0) {
    await page.getByTestId("home-open-workspace-repo-1").click();
  }

  await expect(page.getByText(prompt)).toBeVisible();
  await expect(page.getByText("Applied preview feedback.")).toBeVisible();
});

test("observability can open the matching sandbox health tab in the workspace", async ({
  page,
}) => {
  await initializeTrackedEvents(page);
  await enableE2EAuth(page);

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

  await page.goto("/observability");
  await page.waitForLoadState("networkidle");

  const callsSection = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Calls" }) });
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
  await enableE2EAuth(page);

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

  const liveRunsSection = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Live Runs" }) });
  const callsSection = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Calls" }) });
  await expect(liveRunsSection.getByText("claude-sonnet-4")).toBeVisible();
  await expect(liveRunsSection.getByText("gpt-5-mini")).toHaveCount(0);
  await expect(liveRunsSection.getByText(/^openai\/gpt-5$/)).toHaveCount(0);
  await expect(callsSection.getByText("Repo: acme/demo-app")).toBeVisible();
  await expect(
    callsSection.getByText("Sandbox: sandbox-record-repo-1")
  ).toBeVisible();
  await expect(
    callsSection.getByRole("button", { name: "Clear repo filter" })
  ).toBeVisible();
  await expect(
    callsSection.getByRole("button", { name: "Clear sandbox filter" })
  ).toBeVisible();
  await expect(callsSection.getByText("claude-sonnet-4")).toBeVisible();
  await expect(callsSection.getByText("Sandbox Billing")).toBeVisible();
  await expect(
    callsSection.getByRole("button", { name: "Open sandbox health" })
  ).toBeVisible();
  await expect(callsSection.getByText(/^gpt-5$/)).toHaveCount(0);
  await expect(callsSection.getByText("gpt-5-mini")).toHaveCount(0);

  await callsSection
    .getByRole("button", { name: "Clear sandbox filter" })
    .click();

  await expect(page).toHaveURL(/\/observability\?repo_id=repo-1/);
  await expect(liveRunsSection.getByText("claude-sonnet-4")).toBeVisible();
  await expect(liveRunsSection.getByText("gpt-5-mini")).toBeVisible();
  await expect(liveRunsSection.getByText(/^openai\/gpt-5$/)).toHaveCount(0);
  await expect(callsSection.locator("tbody tr")).toHaveCount(2);
  await expect(callsSection.getByText("Sandbox Billing")).toHaveCount(0);
  await expect(
    callsSection.getByRole("button", { name: "Open sandbox health" })
  ).toHaveCount(0);
  await expect(callsSection.getByText("claude-sonnet-4")).toBeVisible();
  await expect(callsSection.getByText("gpt-5-mini")).toBeVisible();
  await expect(callsSection.getByText(/^gpt-5$/)).toHaveCount(0);
  await expect(callsSection.getByText("Call:")).toHaveCount(0);
  await expect(
    callsSection.getByRole("button", { name: "Clear call selection" })
  ).toHaveCount(0);

  const secondaryRepoCallRow = callsSection
    .locator("tbody tr")
    .filter({ has: page.getByText("gpt-5-mini") })
    .first();
  await secondaryRepoCallRow.click();

  await expect(page).toHaveURL(/call_id=call-1b/);
  await expect(callsSection.getByText("Call: call-1b")).toBeVisible();
  await expect(
    callsSection.getByRole("button", { name: "Clear call selection" })
  ).toBeVisible();
  await expect(
    callsSection.getByRole("button", { name: "Copy exact call link" })
  ).toBeVisible();
  await expect(
    callsSection.getByText("sandbox-record-repo-1b", { exact: true })
  ).toBeVisible();
  await expect(callsSection.getByText("proj_user_456")).toBeVisible();

  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: new URL(page.url()).origin,
  });
  const expectedExactCallUrl = page.url();
  await callsSection
    .getByRole("button", { name: "Copy exact call link" })
    .click();
  await expect(
    callsSection.getByRole("button", { name: "Copied" })
  ).toBeVisible();
  const copiedExactCallUrl = await page.evaluate(() =>
    navigator.clipboard.readText()
  );
  expect(copiedExactCallUrl).toBe(expectedExactCallUrl);

  await page.reload();
  await page.waitForLoadState("networkidle");

  const reloadedCallsSection = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Calls" }) });
  await expect(page).toHaveURL(/call_id=call-1b/);
  await expect(reloadedCallsSection.getByText("Call: call-1b")).toBeVisible();
  await expect(
    reloadedCallsSection.getByRole("button", { name: "Clear call selection" })
  ).toBeVisible();
  await expect(
    reloadedCallsSection.getByText("sandbox-record-repo-1b", { exact: true })
  ).toBeVisible();
  await expect(reloadedCallsSection.getByText("proj_user_456")).toBeVisible();

  await reloadedCallsSection
    .getByRole("button", { name: "Clear call selection" })
    .click();

  await expect(page).toHaveURL(/\/observability\?repo_id=repo-1$/);
  await expect(page).not.toHaveURL(/call_id=/);
  await expect(reloadedCallsSection.getByText("Call:")).toHaveCount(0);
  await expect(
    reloadedCallsSection.getByRole("button", { name: "Clear call selection" })
  ).toHaveCount(0);
  await expect(
    reloadedCallsSection.getByText("sandbox-record-repo-1b", { exact: true })
  ).toHaveCount(0);

  const restoredSecondaryRepoCallRow = reloadedCallsSection
    .locator("tbody tr")
    .filter({ has: page.getByText("gpt-5-mini") })
    .first();
  await restoredSecondaryRepoCallRow.click();

  await expect(page).toHaveURL(/repo_id=repo-1/);
  await expect(page).toHaveURL(/call_id=call-1b/);
  await expect(reloadedCallsSection.getByText("Call: call-1b")).toBeVisible();

  await reloadedCallsSection
    .getByRole("button", { name: "Clear repo filter" })
    .click();

  await expect(page).not.toHaveURL(/repo_id=/);
  await expect(page).toHaveURL(/call_id=call-1b/);
  await expect(callsSection.getByText("Call: call-1b")).toBeVisible();
  await expect(
    callsSection.getByRole("button", { name: "Clear call selection" })
  ).toBeVisible();
  await expect(callsSection.locator("tbody tr")).toHaveCount(4);
  await expect(callsSection.getByText("claude-sonnet-4")).toBeVisible();
  await expect(callsSection.getByText("gpt-5-mini")).toBeVisible();
  await expect(callsSection.getByText(/^gpt-5$/)).toBeVisible();
  await expect(
    callsSection.getByText("sandbox-record-repo-1b", { exact: true })
  ).toBeVisible();

  const globalSecondaryRepoCallRow = callsSection
    .locator("tbody tr")
    .filter({ has: page.getByText("gpt-5-mini") })
    .first();
  await globalSecondaryRepoCallRow.click();

  await expect(page).not.toHaveURL(/call_id=/);
  await expect(callsSection.getByText("Call:")).toHaveCount(0);
  await expect(
    callsSection.getByRole("button", { name: "Clear call selection" })
  ).toHaveCount(0);
  await expect(
    callsSection.getByText("sandbox-record-repo-1b", { exact: true })
  ).toHaveCount(0);
});

import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth } from "./helpers/auth";
import {
  connectedUser,
  getTrackedEvents,
  initializeTrackedEvents,
  mockActivationFlow,
  waitForTrackedEvent,
} from "./helpers/activation-fixtures";
import { capturePageErrors } from "./helpers/page-errors";

const workspacePath = `/${connectedUser.username}/projects/workspace`;

test("activation flow tracks repo sync, preview start, workspace open, and preview feedback", async ({
  page,
}) => {
  await initializeTrackedEvents(page);
  await enableScopedE2EAuth(page);
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

  const chatResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/chat") &&
      response.request().method() === "POST"
  );
  await page.getByTestId("preview-feedback-send").click();
  await chatResponse;

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
  await enableScopedE2EAuth(page);
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

  const terminal = page
    .locator('[data-pane-type="terminal"]')
    .locator(".wterm");
  const verticalResizeHandle = page
    .locator(
      '[data-slot="resizable-handle"][data-panel-group-direction="vertical"]'
    )
    .first();
  const resizeHandleBox = await verticalResizeHandle.boundingBox();
  if (!resizeHandleBox) {
    throw new Error("Terminal resize handle was not visible");
  }
  // Flush the component's two-frame resize correction plus one assertion frame.
  const waitForDeferredTerminalRender = () =>
    page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              requestAnimationFrame(() => resolve());
            });
          });
        })
    );

  await terminal.focus();
  // Empty submissions are echoed locally, so this creates scrollback without
  // introducing sandbox PTY round trips into the layout regression.
  for (let i = 0; i < 40; i += 1) {
    await page.keyboard.press("Enter");
  }
  await expect(terminal).toHaveClass(/has-scrollback/);

  await page.mouse.move(
    resizeHandleBox.x + resizeHandleBox.width / 2,
    resizeHandleBox.y + resizeHandleBox.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(
    resizeHandleBox.x + resizeHandleBox.width / 2,
    resizeHandleBox.y - 80,
    { steps: 8 }
  );
  await page.mouse.up();

  await expect
    .poll(() =>
      terminal.evaluate((element) => {
        const distanceFromBottom =
          element.scrollHeight - element.scrollTop - element.clientHeight;
        return Math.abs(distanceFromBottom) < 1;
      })
    )
    .toBe(true);
  await waitForDeferredTerminalRender();

  await terminal.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll"));
  });
  const terminalHeightBeforeManualScrollResize = await terminal.evaluate(
    (element) => element.clientHeight
  );
  const currentResizeHandleBox = await verticalResizeHandle.boundingBox();
  if (!currentResizeHandleBox) {
    throw new Error("Terminal resize handle disappeared after the first drag");
  }
  await page.mouse.move(
    currentResizeHandleBox.x + currentResizeHandleBox.width / 2,
    currentResizeHandleBox.y + currentResizeHandleBox.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(
    currentResizeHandleBox.x + currentResizeHandleBox.width / 2,
    currentResizeHandleBox.y + 40,
    { steps: 4 }
  );
  await page.mouse.up();
  await expect
    .poll(() => terminal.evaluate((element) => element.clientHeight))
    .not.toBe(terminalHeightBeforeManualScrollResize);
  await waitForDeferredTerminalRender();
  expect(await terminal.evaluate((element) => element.scrollTop)).toBe(0);

  const agentPane = page.locator('[data-pane-type="agent"]').first();
  await agentPane.getByTitle("Add pane").click();
  // The add-pane menu lists each pane type twice (split right + "Split below");
  // take the first (horizontal split).
  await page.getByRole("menuitem", { name: "Files" }).first().click();

  await expect(page.getByText("panes: 4")).toBeVisible();
  const filesPane = page.locator('[data-pane-type="files"]').last();
  // File tree renders names across multiple elements; use the treeitem role
  await expect(
    filesPane.getByRole("treeitem", { name: "package.json" })
  ).toBeVisible();

  await filesPane.getByTitle("Close pane").click();

  await expect(page.getByText("panes: 3")).toBeVisible();
  await expect(page.locator('[data-pane-type="files"]')).toHaveCount(0);
});

test("workspace editor starts language diagnostics without page errors", async ({
  page,
}) => {
  const pageErrors = capturePageErrors(page);
  await enableScopedE2EAuth(page);
  await mockActivationFlow(page);

  await page.goto(workspacePath);
  await page.waitForLoadState("networkidle");
  await page.getByTestId("home-sync-repos").click();
  await page.getByTestId("home-open-workspace-repo-1").click();

  await page.getByTitle("Add pane").first().click();
  await page.getByRole("menuitem", { name: "Files" }).first().click();
  await page
    .locator('[data-pane-type="files"]')
    .getByRole("treeitem", { name: "package.json" })
    .click();

  const editorPane = page.locator('[data-pane-type="editor"]');
  await expect(editorPane.locator(".monaco-editor")).toBeVisible();
  await expect(editorPane).not.toContainText("Illegal value for token color");

  const editorLines = editorPane.locator(".view-lines");
  await expect(editorLines).toContainText("demo-app");
  await editorLines.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type('{"name":');

  await expect(editorPane.locator(".squiggly-error").first()).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("terminal session survives navigation away from the workspace", async ({
  page,
}) => {
  await initializeTrackedEvents(page);
  await enableScopedE2EAuth(page);
  await mockActivationFlow(page);

  await page.goto(workspacePath);
  await page.waitForLoadState("networkidle");
  await page.getByTestId("home-sync-repos").click();
  await page.getByTestId("home-open-workspace-repo-1").click();

  const terminal = page
    .locator('[data-pane-type="terminal"]')
    .locator(".wterm");
  await expect(terminal).toContainText("Terminal Ready");
  await terminal.focus();
  await page.keyboard.type("route-persistence-marker");
  await expect(terminal).toContainText("route-persistence-marker");

  const terminalHost = page.locator("[data-terminal-session-host]").first();
  const terminalHostHandle = await terminalHost.elementHandle();
  if (!terminalHostHandle) {
    throw new Error("Terminal session host was not mounted");
  }

  await page.getByTestId("app-nav-workspaces").click();
  await expect(page).toHaveURL(
    `/${connectedUser.username}/projects/repositories`
  );
  expect(
    await terminalHostHandle.evaluate((element) => element.isConnected)
  ).toBe(true);

  await page.getByRole("link", { name: "Workspace", exact: true }).click();
  await expect(page).toHaveURL(workspacePath);
  await expect(terminal).toContainText("route-persistence-marker");

  const returnedTerminalHostHandle = await page
    .locator("[data-terminal-session-host]")
    .first()
    .elementHandle();
  if (!returnedTerminalHostHandle) {
    throw new Error("Terminal session host did not return to the workspace");
  }
  expect(
    await page.evaluate(
      ([before, after]) => before === after,
      [terminalHostHandle, returnedTerminalHostHandle]
    )
  ).toBe(true);
});

test("workspace chat conversation persists after reload", async ({ page }) => {
  await initializeTrackedEvents(page);
  await enableScopedE2EAuth(page);
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

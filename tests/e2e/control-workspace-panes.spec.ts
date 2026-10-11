import { expect, test } from "@playwright/test";
import { mockControlWorkspace } from "./helpers/control-workspace-fixture";

test("task tools stay beside the conversation and preserve its draft", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const { mutations } = await mockControlWorkspace(page);
  const composer = page.getByRole("textbox", {
    name: "Ask for follow-up changes",
  });
  await composer.fill("Keep this draft while I inspect the result");
  await page.getByRole("button", { name: "Open preview", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Task tools" });
  await expect(
    panel.getByTitle("Sandbox Preview", { exact: true })
  ).toHaveAttribute("src", "https://preview.example.test/one");
  await expect(composer).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("workspace-desktop.png") });
  await expect(
    page.getByText("The welcome page is ready for review.", { exact: true })
  ).toBeVisible();
  const frame = await panel
    .getByTitle("Sandbox Preview", { exact: true })
    .elementHandle();
  await page.getByRole("button", { name: "Close task tools" }).click();
  await page.getByRole("button", { name: "Open preview", exact: true }).click();
  expect(await frame!.evaluate((node) => node.isConnected)).toBe(true);
  await page.getByRole("button", { name: "Open changes", exact: true }).click();
  await expect(panel).toContainText("app/page.tsx");
  await panel.getByText("app/page.tsx", { exact: true }).click();
  await expect(panel).toContainText("Welcome home");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Open plan", exact: true }).click();
  await expect(panel).toContainText("Update welcome copy");
  await page.getByRole("button", { name: "Close task tools" }).click();
  await expect(composer).toHaveValue(
    "Keep this draft while I inspect the result"
  );
  await page
    .getByRole("button", { name: "Open terminal", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Task terminal" })
  ).toBeVisible();
  await expect(page).toHaveURL(/\/control\?mission=task-one/);
  await page.getByRole("tab", { name: "Agent commands", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Task terminal" })
  ).toContainText("12 checks passed");
  await page.getByRole("button", { name: "Close terminal" }).click();
  await expect(composer).toHaveValue(
    "Keep this draft while I inspect the result"
  );
  expect(mutations).toEqual([]);
});

test("mobile tools use a full-width view and return to the same conversation", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockControlWorkspace(page);
  await expect(page.locator(".app-statusbar")).toContainText("Sandboxes");
  await expect(page.locator(".app-statusbar")).not.toContainText(
    "Open a workspace"
  );
  const composer = page.getByRole("textbox", {
    name: "Ask for follow-up changes",
  });
  await composer.fill("Mobile draft");
  expect((await page.getByRole("banner").boundingBox())!.height).toBeLessThan(
    80
  );
  await page.getByRole("button", { name: "Open plan", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Task tools" });
  await expect(panel).toContainText("Update welcome copy");
  await page.screenshot({ path: testInfo.outputPath("workspace-mobile.png") });
  const box = await panel.boundingBox();
  expect(box!.width).toBeGreaterThan(350);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "Close task tools" }).click();
  await expect(composer).toBeVisible();
  await expect(composer).toHaveValue("Mobile draft");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth)
  ).toBeLessThanOrEqual(390);
});

for (const state of ["paused", "stopped"] as const) {
  test(`${state} task previews show recovery controls without loading a stopped provider page`, async ({
    page,
  }) => {
    const { sandboxes } = await mockControlWorkspace(page);
    const sandbox = sandboxes[0];
    sandbox.status = state;
    sandbox.health_status = state;
    sandbox.runtime_summary = {
      ...sandbox.runtime_summary!,
      status: state,
      health_status: state,
      persistent: true,
    };
    await page.route("**/api/sandbox/*/health", (route) =>
      route.fulfill({
        json: { status: state, healthStatus: state, sandbox },
      })
    );
    let providerRequests = 0;
    page.on("request", (request) => {
      if (request.url().startsWith("https://preview.example.test/"))
        providerRequests++;
    });
    await page.reload();
    await expect(
      page.getByRole("button", {
        name: new RegExp(
          `Selected sandbox acme/widgets, branch work/one, ${state === "paused" ? "Paused" : "Stopped"}`
        ),
      })
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Open preview", exact: true })
      .click();
    const panel = page.getByRole("complementary", { name: "Task tools" });
    await expect(
      panel.getByRole("button", {
        name: state === "paused" ? "Resume preview" : "Restart on this branch",
        exact: true,
      })
    ).toBeVisible();
    await expect(panel.locator("iframe")).toHaveCount(0);
    expect(providerRequests).toBe(0);
  });
}

for (const missingBinding of [false, true]) {
  test(`preview requires a task environment when ${missingBinding ? "the saved sandbox is missing" : "multiple sandboxes are available"}`, async ({
    page,
  }) => {
    const { sessions, mutations } = await mockControlWorkspace(page);
    if (missingBinding)
      sessions[1].messages = [
        {
          id: "old-execution",
          role: "assistant",
          parts: [
            {
              type: "dynamic-tool",
              toolName: "run_command",
              toolCallId: "old-command",
              state: "output-available",
              input: { command: "pwd" },
              output: { sandboxId: "missing-sandbox", stdout: "/workspace" },
            },
          ],
        },
      ];
    let providerRequests = 0;
    page.on("request", (request) => {
      if (request.url().startsWith("https://preview.example.test/"))
        providerRequests++;
    });
    await page.getByRole("button", { name: /^Review billing flow/ }).click();
    await page
      .getByRole("button", { name: "Open preview", exact: true })
      .click();
    const panel = page.getByRole("complementary", { name: "Task tools" });
    await expect(panel.locator("iframe")).toHaveCount(0);
    await expect(panel).toContainText("Select a sandbox for this task");
    await panel
      .getByRole("button", { name: "Choose sandbox", exact: true })
      .click();
    await expect(panel).toContainText("work/one");
    await expect(panel).toContainText("work/two");
    expect(providerRequests).toBe(0);
    expect(mutations).toEqual([]);
  });
}

test("sandbox choices and drafts stay attached to their task across switches", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const { mutations } = await mockControlWorkspace(page);
  const composer = page.getByRole("textbox", {
    name: "Ask for follow-up changes",
  });
  await composer.fill("Welcome draft");
  await page.getByRole("button", { name: "Open preview", exact: true }).click();
  await page.getByRole("button", { name: /^Review billing flow/ }).click();
  await expect(
    page.getByRole("button", {
      name: "Choose sandbox for this task",
      exact: true,
    })
  ).toBeVisible();
  await composer.fill("Billing draft");
  await page
    .getByRole("button", { name: "Choose sandbox for this task", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: /Select acme\/widgets, branch work\/two/ })
    .click();
  await page.getByRole("button", { name: "Open preview", exact: true }).click();
  await expect(
    page.getByTitle("Sandbox Preview", { exact: true })
  ).toHaveAttribute("src", "https://preview.example.test/two");
  await page.getByRole("button", { name: /^Refresh welcome page/ }).click();
  await expect(composer).toHaveValue("Welcome draft");
  await expect(
    page.getByTitle("Sandbox Preview", { exact: true })
  ).toHaveAttribute("src", "https://preview.example.test/one");
  await page.getByRole("button", { name: /^Review billing flow/ }).click();
  await expect(composer).toHaveValue("Billing draft");
  await page.reload();
  await expect(
    page.getByRole("button", {
      name: /Selected sandbox acme\/widgets, branch work\/two/,
    })
  ).toBeVisible();
  expect(mutations).toEqual([]);
});

test("files can be inspected without writing to the sandbox", async ({
  page,
}) => {
  const { mutations } = await mockControlWorkspace(page);
  await page.getByRole("button", { name: "Open files", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Task tools" });
  await panel.getByRole("treeitem", { name: "page.tsx", exact: true }).click();
  await expect(panel.locator(".monaco-editor")).toContainText("Welcome home");
  await panel.getByRole("button", { name: "Back to files" }).click();
  await expect(
    panel.getByRole("treeitem", { name: "page.tsx", exact: true })
  ).toBeVisible();
  expect(mutations).toEqual([]);
});

test("workspace tools remain usable at tablet width in light mode", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 820, height: 1024 });
  await mockControlWorkspace(page, "light");
  await page.getByRole("button", { name: "Open preview", exact: true }).click();
  await expect(page.locator("html")).toHaveClass(/light/);
  const panel = page.getByRole("complementary", { name: "Task tools" });
  await expect(
    panel.getByTitle("Sandbox Preview", { exact: true })
  ).toHaveAttribute("src", "https://preview.example.test/one");
  for (const tool of ["preview", "changes", "files", "plan", "terminal"]) {
    await expect(
      page.getByRole("button", { name: `Open ${tool}`, exact: true })
    ).toBeInViewport({ ratio: 1 });
  }
  const bounds = await panel.boundingBox();
  expect(bounds!.width).toBeGreaterThan(400);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(820);
  await page.screenshot({
    path: testInfo.outputPath("workspace-tablet-light.png"),
  });
  await page.getByRole("button", { name: "Close task tools" }).click();
  await expect(
    page.getByRole("button", { name: "Open preview", exact: true })
  ).toBeFocused();
  await expect(
    page.getByRole("textbox", { name: "Ask for follow-up changes" })
  ).toBeVisible();
});

test("failed change requests surface an error and can be retried", async ({
  page,
}) => {
  await mockControlWorkspace(page);
  let fail = true;
  await page.route("**/api/sandbox/sandbox-one/changes", (route) =>
    route.fulfill({
      status: fail ? 503 : 200,
      contentType: "application/json",
      body: JSON.stringify(
        fail
          ? { error: "Sandbox is reconnecting" }
          : {
              branch: "work/one",
              baseBranch: "main",
              ahead: 0,
              behind: 0,
              files: [],
            }
      ),
    })
  );
  await page.getByRole("button", { name: "Open changes", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Task tools" });
  await expect(panel.getByRole("alert")).toHaveText("Sandbox is reconnecting");
  fail = false;
  await panel.getByRole("button", { name: "Retry changes" }).click();
  await expect(panel).toContainText("No uncommitted changes.");
  await expect(panel.getByRole("alert")).toHaveCount(0);
});

test("generated files open as task artifacts and can be reopened", async ({
  page,
}) => {
  const { sessions } = await mockControlWorkspace(page);
  sessions[0].messages.push({
    id: "attachment",
    role: "assistant",
    parts: [
      {
        type: "file",
        url: "data:text/plain,Ready%20to%20review",
        mediaType: "text/plain",
        filename: "handoff.txt",
      },
    ],
  });
  await page.reload();
  const panel = page.getByRole("complementary", { name: "Task tools" });
  await expect(
    panel.getByRole("link", { name: "Open handoff.txt" })
  ).toBeVisible();
  await page.getByRole("button", { name: "Close task tools" }).click();
  await expect(panel).toBeHidden();
  await page
    .getByRole("button", { name: "Open artifacts", exact: true })
    .click();
  await expect(
    panel.getByRole("link", { name: "Open handoff.txt" })
  ).toBeVisible();
});

test("compact navigation expands consistently after keyboard resizing", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await mockControlWorkspace(page);
  const navigation = page.getByTestId("app-sidebar");
  await expect(navigation).toHaveAttribute("data-compact", "true");
  await page.getByRole("separator", { name: "Resize app navigation" }).focus();
  await page.keyboard.press("ArrowRight");
  expect((await navigation.boundingBox())!.width).toBeLessThan(100);
  await page
    .getByRole("button", { name: "Expand navigation", exact: true })
    .click();
  await expect(navigation).toHaveAttribute("data-compact", "false");
  await page
    .getByRole("button", { name: "Collapse navigation", exact: true })
    .click();
  await expect(navigation).toHaveAttribute("data-compact", "true");
});

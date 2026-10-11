import { expect, test } from "@playwright/test";
import { mockControlWorkspace } from "./helpers/control-workspace-fixture";
import { setupControlSidebar } from "./helpers/control-sidebar-fixture";

test("tool buttons collapse and reopen the same preview without losing the draft", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const { mutations } = await mockControlWorkspace(page);
  const composer = page.getByRole("textbox", {
    name: "Ask for follow-up changes",
  });
  await composer.fill("Keep my place");
  const toggle = page.getByRole("button", {
    name: "Open preview",
    exact: true,
  });
  const panel = page.getByRole("complementary", { name: "Task tools" });
  await toggle.click();
  const frame = await panel
    .getByTitle("Sandbox Preview", { exact: true })
    .elementHandle();
  await toggle.click();
  await expect(panel).toBeHidden();
  await toggle.click();
  await expect(panel).toBeVisible();
  expect(await frame!.evaluate((node) => node.isConnected)).toBe(true);
  await expect(composer).toHaveValue("Keep my place");
  const terminal = page.getByRole("button", {
    name: "Open terminal",
    exact: true,
  });
  await terminal.click();
  await expect(
    page.getByRole("region", { name: "Task terminal" })
  ).toBeVisible();
  await terminal.click();
  await expect(
    page.getByRole("region", { name: "Task terminal" })
  ).toBeHidden();
  for (const name of [/^Sandboxes,/, /^Worktrees,/]) {
    const environment = page.getByRole("button", { name });
    await environment.click();
    await expect(panel).toBeVisible();
    await environment.click();
    await expect(panel).toBeHidden();
  }
  expect(mutations).toEqual([]);
});

test("tools expand into the workspace and restore their split size and conversation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await mockControlWorkspace(page);
  const composer = page.getByRole("textbox", {
    name: "Ask for follow-up changes",
  });
  await composer.fill("Continue after reviewing the plan");
  await page.getByRole("button", { name: "Open plan", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Task tools" });
  const before = (await panel.boundingBox())!;
  await page
    .getByRole("button", { name: "Expand task tools", exact: true })
    .click();
  await expect(composer).toBeHidden();
  await expect(panel).toContainText("Update welcome copy");
  await expect
    .poll(async () => (await panel.boundingBox())!.width)
    .toBeGreaterThan(before.width + 200);
  await page.keyboard.press("Escape");
  await expect(composer).toBeVisible();
  await expect(composer).toHaveValue("Continue after reviewing the plan");
  await expect
    .poll(async () => (await panel.boundingBox())!.width)
    .toBeCloseTo(before.width, 0);
  await page
    .getByRole("button", { name: "Open terminal", exact: true })
    .click();
  await page.getByRole("tab", { name: "Agent commands", exact: true }).click();
  await page
    .getByRole("button", { name: "Expand terminal", exact: true })
    .click();
  await expect(composer).toBeHidden();
  await expect(
    page.getByRole("region", { name: "Task terminal" })
  ).toContainText("12 checks passed");
  await page
    .getByRole("button", { name: "Restore terminal size", exact: true })
    .click();
  await expect(composer).toBeVisible();
  await expect(panel).toBeVisible();
});

test("collapsing the sidebar preserves expanded history and collapsed project sections", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 420 });
  const { sidebar } = await setupControlSidebar(page);
  await sidebar.getByRole("button", { name: "Show more", exact: true }).click();
  const other = sidebar.getByRole("button", { name: /^acme\/other/ });
  await other.click();
  await expect(other).toHaveAttribute("aria-expanded", "false");
  const navigation = sidebar.locator("nav");
  const scrollTop = await navigation.evaluate((element) => {
    element.scrollTop = 40;
    return element.scrollTop;
  });
  expect(scrollTop).toBeGreaterThan(0);
  await sidebar
    .getByRole("button", { name: "Collapse sessions", exact: true })
    .click();
  await sidebar
    .getByRole("button", { name: "Expand sessions", exact: true })
    .click();
  await expect(
    sidebar.getByRole("button", { name: "Show less", exact: true })
  ).toBeVisible();
  await expect(other).toHaveAttribute("aria-expanded", "false");
  expect(await navigation.evaluate((element) => element.scrollTop)).toBe(
    scrollTop
  );
});

test("tools can grow beyond the old narrow split while retaining a readable chat", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await mockControlWorkspace(page);
  await page.getByRole("button", { name: "Open preview", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Task tools" });
  await expect(panel).toHaveCSS("transform", "none");
  await expect(
    panel.getByTitle("Sandbox Preview", { exact: true })
  ).toBeVisible();
  const before = (await panel.boundingBox())!;
  const handle = (await page
    .getByRole("separator", { name: "Resize task tools" })
    .boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 180);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 - 250, handle.y + 180, {
    steps: 10,
  });
  await page.mouse.up();
  expect((await panel.boundingBox())!.width).toBeGreaterThan(
    before.width + 230
  );
  await expect(
    page.getByRole("textbox", { name: "Ask for follow-up changes" })
  ).toBeVisible();
});

test("pane transitions animate, remain interruptible, and respect reduced motion", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await mockControlWorkspace(page);
  const plan = page.getByRole("button", { name: "Open plan", exact: true });
  const panel = page.getByRole("complementary", { name: "Task tools" });
  const reveal = () =>
    plan.evaluate(
      (button) =>
        new Promise<string[]>((resolve) => {
          const pane = document.querySelector<HTMLElement>(
            '[aria-label="Task tools"].task-tools'
          )!;
          const frames: string[] = [];
          const started = performance.now();
          const sample = () => {
            frames.push(getComputedStyle(pane).transform);
            if (performance.now() - started >= 350) resolve(frames);
            else requestAnimationFrame(sample);
          };
          (button as HTMLButtonElement).click();
          requestAnimationFrame(sample);
        })
    );
  expect(new Set(await reveal()).size).toBeGreaterThan(1);
  await page
    .getByRole("textbox", { name: "Ask for follow-up changes" })
    .fill("Keep typing through pane changes");
  await plan.click({ clickCount: 3 });
  await expect(panel).toBeHidden();
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(new Set(await reveal())).toEqual(new Set(["none"]));
  await expect(panel).toContainText("Update welcome copy");
  await expect(panel).toHaveCSS("transform", "none");
  await plan.click();
  await expect(panel).toBeHidden();
  await expect(
    page.getByRole("textbox", { name: "Ask for follow-up changes" })
  ).toHaveValue("Keep typing through pane changes");
});

test("terminal resizing follows the pointer without animation lag", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await mockControlWorkspace(page);
  await page
    .getByRole("button", { name: "Open terminal", exact: true })
    .click();
  const terminal = page.getByRole("region", { name: "Task terminal" });
  await expect(terminal).toHaveCSS("transform", "none");
  const before = (await terminal.boundingBox())!;
  const handle = (await page
    .getByRole("separator", { name: "Resize terminal" })
    .boundingBox())!;
  const x = handle.x + handle.width / 2;
  const y = handle.y + handle.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 80, { steps: 10 });
  expect((await terminal.boundingBox())!.height).toBeGreaterThan(
    before.height + 70
  );
  await page.mouse.up();
});

test("collapsing command output does not initialize an interactive terminal", async ({
  page,
}) => {
  await mockControlWorkspace(page);
  await page
    .getByRole("button", { name: "Agent commands (1)", exact: true })
    .click();
  const shell = page.locator("#task-output-terminal");
  await expect(shell).toContainText("Select a sandbox to open its terminal.");
  await page
    .getByRole("button", { name: "Open terminal", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Task terminal" })
  ).toBeHidden();
  await expect(shell).toContainText("Select a sandbox to open its terminal.");
});

import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  initializeTrackedEvents,
  mockActivationFlow,
} from "./helpers/activation-fixtures";

test("terminal reports an interrupted command stream and can execute the next command", async ({
  page,
}) => {
  await initializeTrackedEvents(page);
  await enableScopedE2EAuth(page);
  await mockActivationFlow(page);
  let executions = 0;
  await page.route("**/api/sandbox/*/exec", async (route) => {
    executions++;
    const events =
      executions === 1
        ? [{ type: "run", cmdId: "cmd-interrupted" }]
        : [
            { type: "run", cmdId: "cmd-next" },
            { type: "log", stream: "stdout", data: "next-command-ok\n" },
            { type: "done", exitCode: 0, cwd: "/workspace" },
          ];
    await route.fulfill({
      contentType: "text/event-stream",
      body:
        ": keepalive\n\n" +
        events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
    });
  });
  await page.goto(scopedPath("projects/workspace"));
  await page.waitForLoadState("networkidle");
  await page.getByTestId("home-sync-repos").click();
  await page.getByTestId("home-open-workspace-repo-1").click();
  const terminal = page
    .locator('[data-pane-type="terminal"]')
    .locator(".wterm");
  await expect(terminal).toContainText("Terminal Ready");
  await terminal.focus();
  await page.keyboard.type("pwd");
  await page.keyboard.press("Enter");
  await expect(terminal).toContainText(
    "Terminal connection ended before command completion."
  );
  expect(executions).toBe(1);
  await page.keyboard.type("pwd");
  await page.keyboard.press("Enter");
  await expect(terminal).toContainText("next-command-ok");
  expect(executions).toBe(2);
});

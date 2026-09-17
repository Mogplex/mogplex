import { expect, test, type WebSocketRoute } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  initializeTrackedEvents,
  mockActivationFlow,
} from "./helpers/activation-fixtures";

test("tmux status color stays on its row through output and resize", async ({
  page,
}, testInfo) => {
  await initializeTrackedEvents(page);
  await enableScopedE2EAuth(page);
  await mockActivationFlow(page);
  let acceptSocket!: (socket: WebSocketRoute) => void;
  const connected = new Promise<WebSocketRoute>((resolve) => {
    acceptSocket = resolve;
  });
  await page.routeWebSocket("**/terminal-color-fixture", (ws) => {
    acceptSocket(ws);
  });
  await page.route("**/api/sandbox/*/terminal/connect", (route) =>
    route.fulfill({
      json: {
        available: true,
        terminalSessionKey: "fixture",
        wsUrl: `ws://localhost:${process.env.PLAYWRIGHT_PORT || 3000}/terminal-color-fixture`,
        token: "fixture",
        expiresAt: Date.now() + 60_000,
      },
    })
  );
  await page.goto(scopedPath("projects/workspace"));
  await page.getByTestId("home-sync-repos").click();
  await page.getByTestId("home-open-workspace-repo-1").click();
  const terminal = page.locator('[data-pane-type="terminal"] .wterm');
  await expect(terminal.locator(".term-row").first()).toBeAttached();
  const socket = await connected;
  const paint = () =>
    socket.send(
      Buffer.from(
        "\u001B[0m\u001B[2J\u001B[Hcommand-output-ok\u001B[999;1H\u001B[30;42m[tmux status]\u001B[K\u001B[0m\u001B[2;1Hshell-ready> "
      )
    );
  paint();
  await expect(terminal).toContainText("command-output-ok");
  const assertColors = async () => {
    const colors = await terminal.evaluate((el) => ({
      base: getComputedStyle(el).backgroundColor,
      grid: getComputedStyle(el.querySelector(".term-grid")!).backgroundColor,
      status: getComputedStyle(
        Array.from(el.querySelectorAll(".term-row")).find((row) =>
          row.textContent?.includes("[tmux status]")
        )!
      ).backgroundColor,
    }));
    expect(colors.grid).toBe(colors.base);
    expect(colors.status).not.toBe(colors.base);
  };
  await assertColors();
  await page.setViewportSize({ width: 1100, height: 800 });
  paint();
  await expect(terminal).toContainText("shell-ready>");
  await assertColors();
  await terminal.screenshot({
    path: testInfo.outputPath("terminal-colors.png"),
  });
});

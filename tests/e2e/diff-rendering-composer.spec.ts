import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  buildUiMessageStreamBody,
  fulfillJson,
  mockBaseApp,
  modelId,
  repo,
} from "./helpers/diff-rendering-fixtures";

test("composer shows agent activity immediately and clears it after completion", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockBaseApp(page);

  await page.route(/\/api\/conversations(?:\?.*)?$/, async (route) => {
    if (route.request().method() === "GET") {
      await fulfillJson(route, {
        messages: [],
        local_msgs: [],
        model: modelId,
        mode: "AUTO",
      });
      return;
    }
    await fulfillJson(route, { ok: true });
  });

  let releaseResponse: (() => void) | undefined;
  const responseReleased = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  let chatRequests = 0;
  await page.route("**/api/chat", async (route) => {
    chatRequests += 1;
    await responseReleased;
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "x-vercel-ai-ui-message-stream": "v1",
      },
      body: buildUiMessageStreamBody("Finished the work."),
    });
  });

  await page.goto(scopedPath("projects/workspace"));
  await page.waitForLoadState("networkidle");
  await page.getByTestId(`home-open-workspace-${repo.id}`).click();
  const composer = page.getByRole("textbox", {
    name: "Ask the agent what to build, fix, or explain. Type / for commands or drop files here.",
  });
  await composer.fill("do the work");
  await page.keyboard.press("Enter");

  const indicator = page.getByTestId("agent-running-indicator");
  await expect(indicator).toContainText("Agent is working");
  await expect(indicator.getByRole("button", { name: "Stop" })).toBeVisible();

  const runningComposer = page.getByRole("textbox", {
    name: "Agent is working. You can draft the next message here.",
  });
  await runningComposer.fill("/");
  await page.keyboard.press("Tab");
  await expect(runningComposer).toHaveValue("/");
  expect(chatRequests).toBe(1);

  await runningComposer.fill("queue this next");
  await page.keyboard.press("Enter");
  await expect(runningComposer).toHaveValue("queue this next");
  expect(chatRequests).toBe(1);

  releaseResponse?.();
  await expect(page.getByText("Finished the work.")).toBeVisible();
  await expect(indicator).toHaveCount(0);
});

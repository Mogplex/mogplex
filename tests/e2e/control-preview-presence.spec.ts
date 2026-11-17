import { expect, test } from "@playwright/test";
import { mockControlWorkspace } from "./helpers/control-workspace-fixture";
import { recoveryStream } from "./helpers/control-recovery-fixtures";
import { scopedPath } from "./helpers/auth";

test("an attached preview stays attached across follow-ups and releases on leaving the task", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const { presenceEvents, mutations } = await mockControlWorkspace(page);
  await page.route("**/api/control/chat", (route) =>
    route.fulfill({
      headers: {
        "content-type": "text/event-stream",
        "x-vercel-ai-ui-message-stream": "v1",
      },
      body: recoveryStream(),
    })
  );
  const attached = page.waitForResponse(
    (response) =>
      response.url().endsWith("/presence") &&
      response.request().postDataJSON().event === "attach"
  );
  await page.getByRole("button", { name: "Open preview", exact: true }).click();
  await attached;
  const frame = await page
    .getByTitle("Sandbox Preview", { exact: true })
    .elementHandle();
  await page
    .getByRole("textbox", { name: "Ask for follow-up changes" })
    .fill("Add a unit test");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    page.getByText("Request recovered.", { exact: true })
  ).toBeVisible();
  expect(await frame!.evaluate((node) => node.isConnected)).toBe(true);
  expect(presenceEvents.map((event) => event.event)).toEqual(["attach"]);
  await page.getByRole("button", { name: "Close task tools" }).click();
  expect(presenceEvents.map((event) => event.event)).toEqual(["attach"]);
  // Unload sends a keepalive request after this document's route fixture can
  // detach. Assert the browser's emitted request, not the fixture's event list.
  const released = page.waitForRequest(
    (request) =>
      request.url().endsWith("/presence") &&
      request.postDataJSON().event === "release"
  );
  await page.goto(`${scopedPath("control")}?mission=task-two`);
  const releaseRequest = await released;
  expect(presenceEvents[0].sandboxId).toBe("sandbox-one");
  expect(new URL(releaseRequest.url()).pathname).toBe(
    "/api/sandbox/sandbox-one/presence"
  );
  expect(releaseRequest.method()).toBe("POST");
  expect(releaseRequest.postDataJSON()).toMatchObject({
    event: "release",
    sessionId: presenceEvents[0].sessionId,
    reason: "pagehide",
  });
  expect(mutations).toEqual([]);
});

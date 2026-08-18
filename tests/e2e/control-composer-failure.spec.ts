import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  fulfillJson,
  mockBaseChrome,
} from "./helpers/automation-control-plane-fixtures";

test("control composer keeps text and attachments when a follow-up send fails", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockBaseChrome(page);
  await page.route("**/api/connections", (route) =>
    fulfillJson(route, { connections: [] })
  );
  await page.route("**/api/repos", (route) =>
    fulfillJson(route, [
      {
        id: "repo-1",
        full_name: "acme/widgets",
        owner: "acme",
        name: "widgets",
        default_branch: "main",
      },
    ])
  );
  const session = {
    id: "session-retry",
    title: "Retry failed follow-up",
    project: "acme/widgets",
    repo_id: "repo-1",
    orchestration_run_id: "run-retry",
    pinned: false,
    archived: false,
    messages: [],
    created_at: "2026-08-13T00:00:00.000Z",
    updated_at: "2026-08-13T00:00:00.000Z",
  };
  await page.route("**/api/control/sessions**", (route) => {
    const id = new URL(route.request().url()).searchParams.get("id");
    return fulfillJson(route, id ? session : [session]);
  });
  await page.route("**/api/control/worktrees**", (route) =>
    fulfillJson(route, { worktrees: [] })
  );
  await page.route("**/api/sandbox", (route) =>
    fulfillJson(route, { sandboxes: [] })
  );
  let releaseRequest: () => void;
  const responseAllowed = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  let requestStarted: () => void;
  const requestReceived = new Promise<void>((resolve) => {
    requestStarted = resolve;
  });
  await page.route("**/api/control/chat", async (route) => {
    requestStarted!();
    await responseAllowed;
    await route.fulfill({ status: 500, body: "orchestrator unavailable" });
  });

  await page.goto(`${scopedPath("control")}?mission=session-retry`);
  const composer = page.getByPlaceholder(
    "Ask for follow-up changes or attach images"
  );
  await expect(composer).toBeVisible();
  await composer.fill("Retry this exact request");
  await page
    .locator('input[type="file"]')
    .last()
    .setInputFiles({
      name: "retry-context.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("do not discard this context"),
    });
  await expect(page.getByText("retry-context.txt")).toBeVisible();
  await page.getByRole("button", { name: "Send" }).click();
  await requestReceived;

  // A submitted draft should leave the composer immediately, rather than
  // waiting for the server to finish accepting or rejecting the request.
  await expect(composer).toHaveValue("");
  releaseRequest!();

  await expect(
    page.locator(".text-accent-amber").filter({ hasText: /./ }).first()
  ).toBeVisible();
  await expect(composer).toHaveValue("Retry this exact request");
  await expect(page.getByText("retry-context.txt")).toBeVisible();
});

import { expect, test } from "@playwright/test";
import {
  mockRecoveryChrome,
  recoverySession,
  recoveryStream,
} from "./helpers/control-recovery-fixtures";
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
  await page.route("**/api/repos**", (route) =>
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

test("a failed first message survives reload and Retry sends it with its attachments once", async ({
  page,
}) => {
  await mockRecoveryChrome(page);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  let created = false;
  const stored = {
    ...recoverySession,
    id: "first-message-session",
    messages: [] as unknown[],
  };
  await page.route("**/api/control/sessions**", (route) => {
    const method = route.request().method();
    if (method === "POST") {
      created = true;
      return fulfillJson(route, stored);
    }
    if (method === "PUT") {
      stored.messages = route.request().postDataJSON().messages;
      return fulfillJson(route, { ok: true, session: stored });
    }
    return fulfillJson(
      route,
      new URL(route.request().url()).searchParams.has("id")
        ? stored
        : created
          ? [stored]
          : []
    );
  });
  let blocked = true;
  const requests: Array<Record<string, unknown>> = [];
  await page.route("**/api/control/chat", (route) => {
    requests.push(route.request().postDataJSON());
    if (blocked) return route.abort("failed");
    return route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "x-vercel-ai-ui-message-stream": "v1",
      },
      body: recoveryStream(),
    });
  });
  await page.goto(scopedPath("control"));
  await page
    .getByPlaceholder("Ask anything or run a command...")
    .fill("Keep my first request");
  await page
    .locator('input[type="file"]')
    .last()
    .setInputFiles({
      name: "first-context.txt",
      mimeType: "text/plain",
      buffer: Buffer.alloc(4 * 1024 * 1024, 65),
    });
  await page.getByRole("button", { name: "Start mission" }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Your first message was not sent" })
  )
    .toContainText("Your first message was not sent")
    .catch(async (error) => {
      throw new Error(
        JSON.stringify({
          message: error.message,
          pageErrors,
          requests,
          storage: await page.evaluate(() =>
            sessionStorage.getItem(
              "mogplex.control.pendingInitial.first-message-session"
            )
          ),
        })
      );
    });
  const savedDraft = await page.evaluate(() =>
    sessionStorage.getItem(
      "mogplex.control.pendingInitial.first-message-session"
    )
  );
  expect(savedDraft).not.toBeNull();
  expect(savedDraft!.length).toBeLessThan(2_000);
  await page.reload();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Your first message was not sent" })
  ).toContainText("Your first message was not sent");
  blocked = false;
  const before = requests.length;
  await page
    .getByRole("alert")
    .filter({ hasText: "Your first message was not sent" })
    .getByRole("button", { name: "Retry" })
    .click();
  await expect(
    page.getByText("Request recovered.", { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText("Keep my first request", { exact: true })
  ).toHaveCount(1);
  expect(requests.length).toBe(before + 1);
  expect(JSON.stringify(requests.at(-1))).toContain("first-context.txt");
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem(
        "mogplex.control.pendingInitial.first-message-session"
      )
    )
  ).toBeNull();
});

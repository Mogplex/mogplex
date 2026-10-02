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

for (const reload of [false, true])
  test(`a failed first message ${reload ? "survives reload" : "retains its optimistic turn"} and Retry sends it with its attachments once`, async ({
    page,
  }) => {
    await mockRecoveryChrome(page);
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
    ).toContainText("Your first message was not sent");
    const savedDraft = await page.evaluate(() =>
      sessionStorage.getItem(
        "mogplex.control.pendingInitial.first-message-session"
      )
    );
    expect(savedDraft).not.toBeNull();
    expect(savedDraft!.length).toBeLessThan(2_000);
    await (reload
      ? page.reload()
      : expect(
          page.getByText("Keep my first request", { exact: true })
        ).toHaveCount(1));
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "Your first message was not sent" })
    ).toContainText("Your first message was not sent");
    expect(requests.length).toBe(1);
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
    const sentMessages = requests.at(-1)?.messages as Array<{
      role: string;
      parts: Array<{ filename?: string }>;
    }>;
    expect(
      sentMessages.filter((message) => message.role === "user")
    ).toHaveLength(1);
    expect(
      sentMessages
        .flatMap((message) => message.parts)
        .some((part) => part.filename === "first-context.txt")
    ).toBe(true);
    expect(
      await page.evaluate(() =>
        sessionStorage.getItem(
          "mogplex.control.pendingInitial.first-message-session"
        )
      )
    ).toBeNull();
  });

test("a first response interrupted after assistant output is not offered as an unsent draft", async ({
  page,
}) => {
  await mockRecoveryChrome(page);
  const stored = {
    ...recoverySession,
    id: "partial-response",
    messages: [] as unknown[],
  };
  await page.route("**/api/control/sessions**", (route) => {
    if (route.request().method() === "POST") return fulfillJson(route, stored);
    if (route.request().method() === "PUT") {
      stored.messages = route.request().postDataJSON().messages ?? [];
      return fulfillJson(route, { session: stored });
    }
    const id = new URL(route.request().url()).searchParams.get("id");
    return fulfillJson(route, id ? stored : []);
  });
  let requests = 0;
  await page.route("**/api/control/chat", (route) => {
    requests++;
    return route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "x-vercel-ai-ui-message-stream": "v1",
      },
      body:
        [
          { type: "start" },
          { type: "text-start", id: "partial" },
          {
            type: "text-delta",
            id: "partial",
            delta: "Partial answer received.",
          },
          { type: "error", errorText: "Response interrupted" },
        ]
          .map((part) => `data: ${JSON.stringify(part)}\n\n`)
          .join("") + "data: [DONE]\n\n",
    });
  });
  await page.goto(scopedPath("control"));
  await page
    .getByPlaceholder("Ask anything or run a command...")
    .fill("Deliver this request once");
  await page
    .getByRole("button", { name: "Start mission", exact: true })
    .click();
  await expect(
    page.getByText("Partial answer received.", { exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("alert").filter({ hasText: "Response interrupted" })
  ).toBeVisible();
  await expect(
    page.getByText("Your first message was not sent", { exact: true })
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Retry", exact: true })
  ).toHaveCount(0);
  await expect(
    page.getByText("Deliver this request once", { exact: true })
  ).toHaveCount(1);
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("mogplex.control.pendingInitial.partial-response")
    )
  ).toBeNull();
  expect(requests).toBe(1);
});

test("first-message Retry sends from this tab when attachment recovery storage is unavailable", async ({
  page,
}) => {
  await mockRecoveryChrome(page);
  await page.addInitScript(() =>
    Object.defineProperty(window, "indexedDB", {
      get: () => {
        throw new DOMException("Storage blocked", "SecurityError");
      },
    })
  );
  const stored = {
    ...recoverySession,
    id: "blocked-recovery",
    messages: [] as unknown[],
  };
  await page.route("**/api/control/sessions**", (route) => {
    if (route.request().method() === "POST") return fulfillJson(route, stored);
    if (route.request().method() === "PUT") {
      stored.messages = route.request().postDataJSON().messages ?? [];
      return fulfillJson(route, { session: stored });
    }
    const id = new URL(route.request().url()).searchParams.get("id");
    return fulfillJson(route, id ? stored : []);
  });
  const requests: Array<{
    messages: Array<{ role: string; parts: Array<{ filename?: string }> }>;
  }> = [];
  await page.route("**/api/control/chat", (route) => {
    requests.push(route.request().postDataJSON());
    return route.fulfill(
      requests.length === 1
        ? { status: 503, body: "Unavailable" }
        : {
            status: 200,
            headers: {
              "content-type": "text/event-stream",
              "x-vercel-ai-ui-message-stream": "v1",
            },
            body: recoveryStream(),
          }
    );
  });
  await page.goto(scopedPath("control"));
  await page
    .getByPlaceholder("Ask anything or run a command...")
    .fill("Keep my text and file");
  await page
    .locator('input[type="file"]')
    .last()
    .setInputFiles({
      name: "blocked-context.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Keep this context"),
    });
  await page
    .getByRole("button", { name: "Start mission", exact: true })
    .click();
  const banner = page
    .getByRole("alert")
    .filter({ hasText: "We could not save this draft" });
  await expect(banner).toBeVisible();
  expect(requests).toHaveLength(1);
  await banner.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(
    page.getByText("Request recovered.", { exact: true })
  ).toBeVisible();
  expect(requests).toHaveLength(2);
  const users = requests[1].messages.filter(
    (message) => message.role === "user"
  );
  expect(users).toHaveLength(1);
  expect(
    users[0].parts.some((part) => part.filename === "blocked-context.txt")
  ).toBe(true);
});

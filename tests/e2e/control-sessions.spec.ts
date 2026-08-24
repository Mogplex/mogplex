import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  fulfillJson,
  mockBaseChrome,
} from "./helpers/automation-control-plane-fixtures";

const NOW = new Date().toISOString();

const SESSION_1_MESSAGES = [
  {
    id: "u1",
    role: "user",
    parts: [{ type: "text", text: "Investigate the auth bug" }],
  },
  {
    id: "a1",
    role: "assistant",
    parts: [{ type: "text", text: "Found it in session.ts." }],
  },
];

test("control sessions: history list, restore, persist, and new session", async ({
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

  const putBodies: Array<{ id?: string; messages?: unknown[] }> = [];
  let posted = false;
  await page.route("**/api/control/sessions**", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const id = url.searchParams.get("id");

    if (request.method() === "GET" && id === "sess-1") {
      return fulfillJson(route, {
        id: "sess-1",
        title: "Earlier investigation",
        project: "acme/widgets",
        repo_id: "repo-1",
        pinned: false,
        archived: false,
        messages: SESSION_1_MESSAGES,
        created_at: NOW,
        updated_at: NOW,
      });
    }
    if (request.method() === "GET") {
      return fulfillJson(route, [
        {
          id: "sess-1",
          title: "Earlier investigation",
          project: "acme/widgets",
          repo_id: "repo-1",
          pinned: false,
          archived: false,
          created_at: NOW,
          updated_at: NOW,
        },
      ]);
    }
    if (request.method() === "POST") {
      posted = true;
      return fulfillJson(route, {
        id: "sess-2",
        title: "Fix billing",
        project: "acme/widgets",
        repo_id: "repo-1",
        pinned: false,
        archived: false,
        messages: [],
        created_at: NOW,
        updated_at: NOW,
      });
    }
    if (request.method() === "PUT") {
      const body = request.postDataJSON() as (typeof putBodies)[number] & {
        expected_updated_at?: string;
      };
      putBodies.push(body);
      return fulfillJson(route, {
        ok: true,
        session: {
          id: body.id,
          title: "Earlier investigation",
          pinned: false,
          archived: false,
          messages: body.messages ?? [],
          created_at: NOW,
          updated_at: new Date().toISOString(),
        },
      });
    }
    return route.fallback();
  });

  const streamChunks = [
    { type: "start" },
    { type: "text-start", id: "t1" },
    { type: "text-delta", id: "t1", delta: "Glad to help." },
    { type: "text-end", id: "t1" },
    { type: "finish" },
  ];
  const streamBody =
    streamChunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") +
    "data: [DONE]\n\n";
  await page.route("**/api/control/chat", (route) =>
    route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "x-vercel-ai-ui-message-stream": "v1",
      },
      body: streamBody,
    })
  );

  await page.goto(scopedPath("control"));
  await page.waitForLoadState("networkidle");

  // History: the sidebar lists the stored session.
  const sidebar = page.getByRole("complementary", { name: "Sessions" });
  await expect(
    sidebar.getByRole("button", { name: /^Earlier investigation/ })
  ).toBeVisible();

  // Restore: selecting it brings back the full conversation.
  await sidebar.getByRole("button", { name: /^Earlier investigation/ }).click();
  await expect(page).toHaveURL(/\/control\?mission=sess-1$/);
  const conversation = page.getByRole("log", { name: "Conversation" });
  await expect(
    conversation.getByText("Investigate the auth bug")
  ).toBeVisible();
  await expect(conversation.getByText("Found it in session.ts.")).toBeVisible();

  // Continue the restored session: the completed turn persists via PUT.
  await page
    .getByPlaceholder("Ask for follow-up changes or attach images")
    .fill("Thanks, ship it");
  await page.keyboard.press("Enter");
  await expect(conversation.getByText("Glad to help.")).toBeVisible();
  await expect
    .poll(() => putBodies.length, { timeout: 10_000 })
    .toBeGreaterThan(0);
  const persisted = putBodies.at(-1);
  expect(persisted?.id).toBe("sess-1");
  expect(
    JSON.stringify(persisted?.messages ?? []).includes("Thanks, ship it")
  ).toBe(true);

  // Multi-session: starting a new session creates a fresh row and clears the
  // chat; the old session stays in the list for switching back. Submit with
  // Enter — at narrow widths the options row wraps the button out of view.
  await sidebar.getByRole("button", { name: "New session" }).click();
  await page
    .getByPlaceholder("Ask anything or run a command...")
    .fill("Fix billing");
  await page.keyboard.press("Enter");
  await expect.poll(() => posted, { timeout: 10_000 }).toBe(true);
  await expect(page).toHaveURL(/\/control\?mission=sess-2$/);
  await expect(
    sidebar.getByRole("button", { name: /^Fix billing/ })
  ).toBeVisible();
  await expect(
    sidebar.getByRole("button", { name: /^Earlier investigation/ })
  ).toBeVisible();

  // Archiving clears both the selection and its now-dead deep link.
  await page.getByRole("button", { name: "More options" }).click();
  await page.getByRole("menuitem", { name: "Archive" }).click();
  await expect(page).toHaveURL(/\/control$/);
  await expect(
    sidebar.getByRole("button", { name: /^Fix billing/ })
  ).toHaveCount(0);
});

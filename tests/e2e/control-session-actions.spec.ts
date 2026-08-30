import { expect, test, type Page } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  fulfillJson,
  mockBaseChrome,
} from "./helpers/automation-control-plane-fixtures";

const NOW = "2026-08-24T12:00:00.000Z";

type Session = {
  id: string;
  title: string;
  project: string;
  repo_id: string;
  model_id: string | null;
  orchestration_run_id: string;
  pinned: boolean;
  archived: boolean;
  messages: unknown[];
  created_at: string;
  updated_at: string;
};

function session(id: string, title: string): Session {
  return {
    id,
    title,
    project: "acme/widgets",
    repo_id: "repo-1",
    model_id: null,
    orchestration_run_id: `run-${id}`,
    pinned: false,
    archived: false,
    messages: [],
    created_at: NOW,
    updated_at: NOW,
  };
}

async function installControlChrome(page: Page) {
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
  await page.route("**/api/control/worktrees**", (route) =>
    fulfillJson(route, { worktrees: [] })
  );
  await page.route("**/api/sandbox", (route) =>
    fulfillJson(route, { sandboxes: [] })
  );
}

function chatStream(text: string) {
  const chunks = [
    { type: "start" },
    { type: "text-start", id: "answer" },
    { type: "text-delta", id: "answer", delta: text },
    { type: "text-end", id: "answer" },
    { type: "finish" },
  ];
  return (
    chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") +
    "data: [DONE]\n\n"
  );
}

test("project and chat rows expose scoped actions without hijacking navigation", async ({
  page,
}) => {
  await installControlChrome(page);
  const sessions = [
    session("session-active", "Active investigation"),
    session("session-old", "Old investigation"),
  ];
  const deletedIds: string[] = [];
  const chatRequests: Array<Record<string, unknown>> = [];
  let rejectFirstDelete = true;

  await page.route("**/api/control/sessions**", (route) => {
    const request = route.request();
    const id = new URL(request.url()).searchParams.get("id");
    if (request.method() === "DELETE" && id) {
      if (id === "session-old" && rejectFirstDelete) {
        rejectFirstDelete = false;
        return fulfillJson(route, { error: "Temporary failure" }, 500);
      }
      deletedIds.push(id);
      const index = sessions.findIndex((entry) => entry.id === id);
      if (index !== -1) sessions.splice(index, 1);
      return fulfillJson(route, { ok: true, id });
    }
    if (request.method() === "PUT") {
      const body = request.postDataJSON() as {
        id?: string;
        messages?: unknown[];
      };
      const target = sessions.find((entry) => entry.id === body.id);
      if (!target) return fulfillJson(route, { error: "Not found" }, 404);
      target.messages = body.messages ?? target.messages;
      target.updated_at = new Date().toISOString();
      return fulfillJson(route, { ok: true, session: target });
    }
    if (request.method() === "GET" && id) {
      return fulfillJson(
        route,
        sessions.find((entry) => entry.id === id) ?? { error: "Not found" },
        sessions.some((entry) => entry.id === id) ? 200 : 404
      );
    }
    if (request.method() === "GET") {
      return fulfillJson(
        route,
        sessions.map(({ messages: _messages, ...summary }) => summary)
      );
    }
    if (request.method() === "POST") {
      const body = request.postDataJSON() as {
        title?: string;
        project?: string;
        repo_id?: string;
        model_id?: string | null;
      };
      const created = {
        ...session("session-project-chat", body.title ?? "Project chat"),
        project: body.project ?? "acme/widgets",
        repo_id: body.repo_id ?? "repo-1",
        model_id: body.model_id ?? null,
      };
      sessions.unshift(created);
      return fulfillJson(route, created);
    }
    return route.fallback();
  });
  await page.route("**/api/control/chat", (route) => {
    chatRequests.push(
      route.request().postDataJSON() as Record<string, unknown>
    );
    return route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "x-vercel-ai-ui-message-stream": "v1",
      },
      body: chatStream("Review started in the selected project."),
    });
  });

  await page.goto(`${scopedPath("control")}?mission=session-active`);
  const sidebar = page.getByRole("complementary", { name: "Sessions" });
  const projectRow = sidebar.getByRole("button", {
    name: /acme\/widgets.*2/,
  });

  await projectRow.click({ button: "right" });
  await page.getByRole("menuitem", { name: "New chat" }).click();
  await expect(page.getByLabel("Project", { exact: true })).toContainText(
    "acme/widgets"
  );
  await page
    .getByPlaceholder("Ask anything or run a command...")
    .fill("Review the last three pull requests");
  await page.getByRole("button", { name: "Start mission" }).click();
  await expect(
    page.getByText("Review started in the selected project.")
  ).toBeVisible();
  await expect.poll(() => chatRequests.length).toBe(1);
  expect(chatRequests[0]).toMatchObject({
    conversationId: "session-project-chat",
    missionId: "session-project-chat",
    repoId: "repo-1",
    repoFullName: "acme/widgets",
    repoOwner: "acme",
    repoName: "widgets",
    repoBaseBranch: "main",
  });

  const oldSessionRow = sidebar.getByRole("button", {
    name: /^Old investigation /,
  });
  await oldSessionRow.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete chat" }).click();
  let inactiveDialog = page.getByRole("alertdialog", {
    name: "Delete Old investigation?",
  });
  await expect(inactiveDialog).toContainText(
    "This permanently deletes the chat history."
  );
  await inactiveDialog.getByRole("button", { name: "Cancel" }).click();
  await expect.poll(() => deletedIds).toEqual([]);
  await expect(oldSessionRow).toBeVisible();

  const oldSessionActions = sidebar.getByRole("button", {
    name: "Actions for Old investigation",
  });
  await oldSessionActions.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("menuitem", { name: "Delete chat" }).click();
  inactiveDialog = page.getByRole("alertdialog", {
    name: "Delete Old investigation?",
  });
  await inactiveDialog.getByRole("button", { name: "Delete chat" }).click();
  await expect(inactiveDialog.getByRole("alert")).toHaveText(
    "The chat could not be deleted. Try again."
  );
  await expect.poll(() => deletedIds).toEqual([]);
  await inactiveDialog.getByRole("button", { name: "Delete chat" }).click();
  await expect.poll(() => deletedIds).toEqual(["session-old"]);
  await expect(
    sidebar.getByRole("button", { name: /Old investigation/ })
  ).toHaveCount(0);

  await sidebar.getByRole("button", { name: /^Active investigation / }).click();
  await expect(
    page.getByPlaceholder("Ask for follow-up changes or attach images")
  ).toBeVisible();
  await sidebar
    .getByRole("button", { name: "Actions for Active investigation" })
    .click();
  await page.getByRole("menuitem", { name: "Delete chat" }).click();
  await page
    .getByRole("alertdialog", { name: "Delete Active investigation?" })
    .getByRole("button", { name: "Delete chat" })
    .click();

  await expect
    .poll(() => deletedIds)
    .toEqual(["session-old", "session-active"]);
  await expect(page).toHaveURL(/\/control$/);
  await expect(
    page.getByText("Active investigation", { exact: true })
  ).toHaveCount(0);
});

test("a follow-up chat is restored after leaving Control and returning", async ({
  page,
}) => {
  await installControlChrome(page);
  let stored: Session | null = null;
  let chatCount = 0;
  let persistedFollowUp = false;

  await page.route("**/api/control/sessions**", (route) => {
    const request = route.request();
    const id = new URL(request.url()).searchParams.get("id");
    if (request.method() === "POST") {
      const body = request.postDataJSON() as {
        title?: string;
        project?: string;
        repo_id?: string;
      };
      stored = {
        ...session("session-follow-up", body.title ?? "Initial request"),
        project: body.project ?? "acme/widgets",
        repo_id: body.repo_id ?? "repo-1",
      };
      return fulfillJson(route, stored);
    }
    if (request.method() === "PUT" && stored) {
      const body = request.postDataJSON() as { messages?: unknown[] };
      stored = {
        ...stored,
        messages: body.messages ?? stored.messages,
        updated_at: new Date().toISOString(),
      };
      persistedFollowUp = JSON.stringify(stored.messages).includes(
        "Follow up with the regression test"
      );
      return fulfillJson(route, { ok: true, session: stored });
    }
    if (request.method() === "GET" && id) {
      return fulfillJson(route, stored);
    }
    if (request.method() === "GET") {
      if (!stored) return fulfillJson(route, []);
      const { messages: _messages, ...summary } = stored;
      return fulfillJson(route, [summary]);
    }
    return route.fallback();
  });
  await page.route("**/api/control/chat", (route) => {
    chatCount += 1;
    return route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "x-vercel-ai-ui-message-stream": "v1",
      },
      body: chatStream(
        chatCount === 1 ? "Initial work complete." : "Regression test added."
      ),
    });
  });

  await page.goto(scopedPath("control"));
  await page
    .getByPlaceholder("Ask anything or run a command...")
    .fill("Start the investigation");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/mission=session-follow-up/);
  await expect(page.getByText("Initial work complete.")).toBeVisible();

  await page
    .getByPlaceholder("Ask for follow-up changes or attach images")
    .fill("Follow up with the regression test");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Regression test added.")).toBeVisible();
  await expect.poll(() => persistedFollowUp).toBe(true);

  await page.goto(scopedPath("settings"));
  await page.goto(scopedPath("control"));

  await expect(page).toHaveURL(/mission=session-follow-up/);
  await expect(
    page.getByText("Follow up with the regression test")
  ).toBeVisible();
  await expect(page.getByText("Regression test added.")).toBeVisible();
});

import { expect, test, type Page } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  fulfillJson,
  mockBaseChrome,
} from "./helpers/automation-control-plane-fixtures";

const NOW = "2026-08-14T18:00:00.000Z";

type StreamControls = {
  started: string[];
  aborted: string[];
  append: (sessionId: string, text: string) => void;
  finish: (sessionId: string) => void;
};

async function installParallelChatStreams(page: Page) {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    const encoder = new TextEncoder();
    const controllers = new Map<string, ReadableStreamDefaultController>();
    const started: string[] = [];
    const aborted: string[] = [];
    const write = (
      controller: ReadableStreamDefaultController,
      chunk: Record<string, unknown> | "[DONE]"
    ) => {
      const payload = chunk === "[DONE]" ? chunk : JSON.stringify(chunk);
      controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
    };

    const controls: StreamControls = {
      started,
      aborted,
      append(sessionId, text) {
        const controller = controllers.get(sessionId);
        if (!controller) throw new Error(`Missing stream for ${sessionId}`);
        write(controller, {
          type: "text-delta",
          id: `text-${sessionId}`,
          delta: text,
        });
      },
      finish(sessionId) {
        const controller = controllers.get(sessionId);
        if (!controller) throw new Error(`Missing stream for ${sessionId}`);
        write(controller, {
          type: "text-delta",
          id: `text-${sessionId}`,
          delta: ` ${sessionId} complete`,
        });
        write(controller, { type: "text-end", id: `text-${sessionId}` });
        write(controller, { type: "finish" });
        write(controller, "[DONE]");
        controller.close();
        controllers.delete(sessionId);
      },
    };

    Object.assign(window, { __controlParallelStreams: controls });
    window.fetch = async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (!url.endsWith("/api/control/chat")) {
        return originalFetch(input, init);
      }

      const body = JSON.parse(String(init?.body ?? "{}")) as {
        conversationId?: string;
      };
      const sessionId = body.conversationId;
      if (!sessionId) throw new Error("Control request omitted conversationId");
      started.push(sessionId);

      const stream = new ReadableStream({
        start(controller) {
          controllers.set(sessionId, controller);
          write(controller, { type: "start" });
          write(controller, { type: "text-start", id: `text-${sessionId}` });
          write(controller, {
            type: "text-delta",
            id: `text-${sessionId}`,
            delta: `${sessionId} progress`,
          });
          init?.signal?.addEventListener(
            "abort",
            () => {
              aborted.push(sessionId);
              controllers.delete(sessionId);
              controller.error(new DOMException("Aborted", "AbortError"));
            },
            { once: true }
          );
        },
      });

      return new Response(stream, {
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "x-vercel-ai-ui-message-stream": "v1",
        },
      });
    };
  });
}

test("control chats keep independent streams, status, and cancellation across switching", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await installParallelChatStreams(page);
  await mockBaseChrome(page);
  await page.route("**/api/connections", (route) =>
    fulfillJson(route, { connections: [] })
  );
  await page.route("**/api/repos", (route) => fulfillJson(route, []));
  await page.route("**/api/control/worktrees**", (route) =>
    fulfillJson(route, { worktrees: [] })
  );

  const sessions = [
    {
      id: "session-a",
      title: "Parallel task A",
      project: null,
      repo_id: null,
      orchestration_run_id: null,
      pinned: false,
      archived: false,
      messages: [] as unknown[],
      created_at: NOW,
      updated_at: NOW,
    },
    {
      id: "session-b",
      title: "Parallel task B",
      project: null,
      repo_id: null,
      orchestration_run_id: null,
      pinned: false,
      archived: false,
      messages: [] as unknown[],
      created_at: NOW,
      updated_at: NOW,
    },
  ];
  const persisted = new Map<string, unknown[]>();

  await page.route("**/api/control/sessions**", async (route) => {
    const request = route.request();
    const id = new URL(request.url()).searchParams.get("id");
    if (request.method() === "GET" && id) {
      const session = sessions.find((entry) => entry.id === id);
      return fulfillJson(route, session);
    }
    if (request.method() === "GET") {
      return fulfillJson(
        route,
        sessions.map(({ messages: _messages, ...summary }) => summary)
      );
    }
    if (request.method() === "PUT") {
      const body = request.postDataJSON() as {
        id: string;
        messages?: unknown[];
      };
      persisted.set(body.id, body.messages ?? []);
      const session = sessions.find((entry) => entry.id === body.id)!;
      session.messages = body.messages ?? [];
      return fulfillJson(route, {
        ok: true,
        session: {
          ...session,
          messages: body.messages ?? [],
          updated_at: new Date().toISOString(),
        },
      });
    }
    return route.fallback();
  });

  await page.goto(scopedPath("control"));
  const sidebar = page.getByRole("complementary", { name: "Sessions" });
  const conversation = page.getByRole("log", { name: "Conversation" });
  const composer = page.getByPlaceholder(
    "Ask for follow-up changes or attach images"
  );

  await sidebar.getByRole("button", { name: /Parallel task A/ }).click();
  await composer.fill("Start A");
  await page.keyboard.press("Enter");
  await expect(conversation.getByText("session-a progress")).toBeVisible();

  await sidebar.getByRole("button", { name: /Parallel task B/ }).click();
  await composer.fill("Start B");
  await page.keyboard.press("Enter");
  await expect(conversation.getByText("session-b progress")).toBeVisible();
  await page.evaluate(() => {
    (
      window as typeof window & {
        __controlParallelStreams: StreamControls;
      }
    ).__controlParallelStreams.append("session-b", " still running");
  });
  await expect(
    conversation.getByText("session-b progress still running")
  ).toBeVisible();
  await expect(
    sidebar.getByRole("button", { name: /Working.*Parallel task A/ })
  ).toBeVisible();
  await expect(
    sidebar.getByRole("button", { name: /Working.*Parallel task B/ })
  ).toBeVisible();

  await sidebar.getByRole("button", { name: /Parallel task A/ }).click();
  await expect(page).toHaveURL(/mission=session-a/);
  await expect(composer).toHaveValue("Start A");
  await expect(conversation.getByText("session-a progress")).toHaveCount(1);
  await sidebar.getByRole("button", { name: /Parallel task B/ }).click();
  await expect(composer).toHaveValue("Start B");
  await expect(conversation.getByText("session-b progress")).toHaveCount(1);

  await page.getByRole("button", { name: "Stop" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & {
              __controlParallelStreams: StreamControls;
            }
          ).__controlParallelStreams.aborted
      )
    )
    .toEqual(["session-b"]);
  await expect(
    sidebar.getByRole("button", { name: /Working.*Parallel task A/ })
  ).toBeVisible();
  await expect(
    sidebar.getByRole("button", { name: /Working.*Parallel task B/ })
  ).toHaveCount(0);

  await page.evaluate(() => {
    (
      window as typeof window & { __controlParallelStreams: StreamControls }
    ).__controlParallelStreams.finish("session-a");
  });
  await sidebar.getByRole("button", { name: /Parallel task A/ }).click();
  await expect(
    conversation.getByText("session-a progress session-a complete")
  ).toBeVisible();
  await expect
    .poll(() => persisted.has("session-a") && persisted.has("session-b"))
    .toBe(true);
  expect(JSON.stringify(persisted.get("session-a"))).toContain(
    "session-a complete"
  );
  expect(JSON.stringify(persisted.get("session-b"))).toContain(
    "session-b progress"
  );
});

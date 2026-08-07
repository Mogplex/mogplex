import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  buildUiEventStreamBody,
  buildUiMessageStreamBody,
  fulfillJson,
  mockBaseApp,
  modelId,
  repo,
} from "./helpers/diff-rendering-fixtures";

test("assistant diff blocks render through the shared diff viewer", async ({
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
  await page.route("**/api/chat", async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "x-vercel-ai-ui-message-stream": "v1",
      },
      body: buildUiMessageStreamBody(
        [
          "I changed the greeting.",
          "",
          "```diff",
          "diff --git a/src/greeting.ts b/src/greeting.ts",
          "index 1111111..2222222 100644",
          "--- a/src/greeting.ts",
          "+++ b/src/greeting.ts",
          "@@ -1 +1 @@",
          "-export const greeting = 'hello'",
          "+export const greeting = 'hello there'",
          "```",
        ].join("\n")
      ),
    });
  });

  await page.goto(scopedPath("projects/workspace"));
  await page.waitForLoadState("networkidle");
  await page.getByTestId(`home-open-workspace-${repo.id}`).click();
  await page
    .getByRole("textbox", {
      name: "Ask the agent what to build, fix, or explain. Type / for commands or drop files here.",
    })
    .fill("show me the patch");
  await page.keyboard.press("Enter");

  await expect(page.getByText("Workspace Chat · demo-app")).toBeVisible();
  await expect(page.getByText("src/greeting.ts")).toBeVisible();
  await expect(
    page.getByText("export const greeting = 'hello there'")
  ).toBeVisible();
  await expect(
    page.getByText("diff --git a/src/greeting.ts b/src/greeting.ts")
  ).toHaveCount(0);
});

test("malformed diff fences fall back to the normal code renderer", async ({
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
  await page.route("**/api/chat", async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "x-vercel-ai-ui-message-stream": "v1",
      },
      body: buildUiMessageStreamBody(
        [
          "This patch is malformed on purpose.",
          "",
          "```diff",
          "this is not a patch",
          "just plain text inside a diff fence",
          "```",
        ].join("\n")
      ),
    });
  });

  await page.goto(scopedPath("projects/workspace"));
  await page.waitForLoadState("networkidle");
  await page.getByTestId(`home-open-workspace-${repo.id}`).click();
  await page
    .getByRole("textbox", {
      name: "Ask the agent what to build, fix, or explain. Type / for commands or drop files here.",
    })
    .fill("show me the malformed patch");
  await page.keyboard.press("Enter");

  await expect(page.getByText("this is not a patch")).toBeVisible();
  await expect(
    page.getByText("just plain text inside a diff fence")
  ).toBeVisible();
  await expect(page.getByText("src/greeting.ts")).toHaveCount(0);
});

test("saved local messages render patches through the shared diff viewer", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockBaseApp(page);

  const patch = [
    "diff --git a/src/local.ts b/src/local.ts",
    "index 1111111..2222222 100644",
    "--- a/src/local.ts",
    "+++ b/src/local.ts",
    "@@ -1 +1 @@",
    "-export const source = 'old'",
    "+export const source = 'local'",
    "",
  ].join("\n");

  await page.route(/\/api\/conversations(?:\?.*)?$/, async (route) => {
    if (route.request().method() === "GET") {
      await fulfillJson(route, {
        messages: [],
        local_msgs: [{ id: "local-1", text: patch }],
        model: modelId,
        mode: "AUTO",
      });
      return;
    }
    await fulfillJson(route, { ok: true });
  });

  await page.goto(scopedPath("projects/workspace"));
  await page.waitForLoadState("networkidle");
  await page.getByTestId(`home-open-workspace-${repo.id}`).click();

  await expect(page.getByText("src/local.ts")).toBeVisible();
  await expect(page.getByText("export const source = 'local'")).toBeVisible();
});

test("assistant tool parts render nested diff output through the shared viewer", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockBaseApp(page);

  const patch = [
    "diff --git a/src/tool.ts b/src/tool.ts",
    "index 1111111..2222222 100644",
    "--- a/src/tool.ts",
    "+++ b/src/tool.ts",
    "@@ -1 +1 @@",
    "-export const toolState = 'waiting'",
    "+export const toolState = 'done'",
    "",
  ].join("\n");

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
  await page.route("**/api/chat", async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "x-vercel-ai-ui-message-stream": "v1",
      },
      body: buildUiEventStreamBody([
        {
          type: "tool-input-available",
          toolCallId: "tool-call-1",
          toolName: "git_diff",
          input: { repo: repo.full_name },
        },
        {
          type: "tool-output-available",
          toolCallId: "tool-call-1",
          output: { stdout: patch },
        },
      ]),
    });
  });

  await page.goto(scopedPath("projects/workspace"));
  await page.waitForLoadState("networkidle");
  await page.getByTestId(`home-open-workspace-${repo.id}`).click();
  await page
    .getByRole("textbox", {
      name: "Ask the agent what to build, fix, or explain. Type / for commands or drop files here.",
    })
    .fill("show me the tool output");
  await page.keyboard.press("Enter");
  await page.getByText("git_diff").click();

  await expect(page.getByText("Diff source: stdout")).toBeVisible();
  await expect(page.getByText("src/tool.ts")).toBeVisible();
  await expect(page.getByText("export const toolState = 'done'")).toBeVisible();
});

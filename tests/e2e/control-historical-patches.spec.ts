import { expect, test } from "@playwright/test";
import type { UIMessage } from "ai";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  fulfillJson,
  mockBaseChrome,
  mockControlSessionBootstrap,
} from "./helpers/automation-control-plane-fixtures";

test("a saved conversation with 50 patches loads viewers only when expanded", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockBaseChrome(page);
  await mockControlSessionBootstrap(page);
  const id = "00000000-0000-4000-8000-000000000078";
  const messages: UIMessage[] = [];
  for (let index = 0; index < 50; index++) {
    messages.push(
      {
        id: `user-${index}`,
        role: "user",
        parts: [{ type: "text", text: `Change ${index}` }],
      },
      {
        id: `response-${index}`,
        role: "assistant",
        parts: [
          {
            type: "tool-apply_patch",
            toolCallId: `patch-${index}`,
            state: "output-available",
            input: { file_path: `file-${index}.ts` },
            output: {
              ok: true,
              patch: `diff --git a/file-${index}.ts b/file-${index}.ts\n--- a/file-${index}.ts\n+++ b/file-${index}.ts\n@@ -1 +1 @@\n-old\n+updated-${index}\n`,
            },
          },
        ],
      }
    );
  }
  messages.push({
    id: "latest",
    role: "user",
    parts: [{ type: "text", text: "Summarize the changes" }],
  });
  const session = {
    id,
    title: "Patch history",
    project: "acme/widgets",
    repo_id: "repo-control-default",
    model_id: null,
    orchestration_run_id: null,
    pinned: false,
    archived: false,
    messages,
    created_at: "2026-11-02T12:00:00Z",
    updated_at: "2026-11-02T12:00:00Z",
  };
  await page.route("**/api/control/sessions**", (route) =>
    fulfillJson(
      route,
      new URL(route.request().url()).searchParams.has("id")
        ? session
        : [session]
    )
  );
  await page.route("**/api/control/turns?**", (route) =>
    fulfillJson(route, { sessionId: id, messages, call: null })
  );
  await page.goto(`${scopedPath("control")}?mission=${id}`);
  const conversation = page.getByRole("log", { name: "Conversation" });
  const patches = conversation
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: "View patch" }) });
  await expect(patches).toHaveCount(50);
  await expect(conversation.locator("diffs-container")).toHaveCount(0);
  await expect(
    conversation.locator("pre").filter({ hasText: "diff --git" })
  ).toHaveCount(0);
  const selected = patches.last();
  await selected.locator("summary").click();
  await expect(selected).toContainText("updated-49");
  await expect(conversation.locator("diffs-container")).toHaveCount(1);
  const viewer = await selected.locator("diffs-container").elementHandle();
  await selected.locator("summary").click();
  expect(await viewer!.evaluate((node) => node.isConnected)).toBe(true);
  await selected.locator("summary").click();
  await expect(selected).toHaveAttribute("open", "");
  expect(await viewer!.evaluate((node) => node.isConnected)).toBe(true);
});

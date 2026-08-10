import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  fulfillJson,
  mockBaseChrome,
} from "./helpers/automation-control-plane-fixtures";

const SAMPLE_PATCH = [
  "diff --git a/lib/auth.ts b/lib/auth.ts",
  "--- a/lib/auth.ts",
  "+++ b/lib/auth.ts",
  "@@ -1,3 +1,4 @@",
  " import { session } from './session'",
  "+import { audit } from './audit'",
  " export function login() {",
  "-  return session.start()",
  "+  audit('login')",
  "+  return session.start()",
  " }",
].join("\n");

test("control chat renders agent diffs inline when tools produce a patch", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockBaseChrome(page);
  await page.route("**/api/connections", (route) =>
    fulfillJson(route, { connections: [] })
  );

  const streamChunks = [
    { type: "start" },
    { type: "text-start", id: "t1" },
    { type: "text-delta", id: "t1", delta: "Patching the auth module." },
    { type: "text-end", id: "t1" },
    {
      type: "tool-input-available",
      toolCallId: "call-1",
      toolName: "apply_patch",
      input: { file_path: "lib/auth.ts" },
    },
    {
      type: "tool-output-available",
      toolCallId: "call-1",
      output: { patch: SAMPLE_PATCH, ok: true },
    },
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

  await page
    .getByPlaceholder("Ask anything or run a command...")
    .fill("Patch the login flow");
  await page.getByRole("button", { name: "Start mission" }).click();

  // The diff renders inline in the conversation: per-file stats plus the
  // highlighted patch content (added line from the hunk).
  const conversation = page.getByRole("log", { name: "Conversation" });
  await expect(conversation.getByText("lib/auth.ts").first()).toBeVisible();
  // Stats appear in both the event's file row and the diff header.
  await expect(conversation.getByText("+3").first()).toBeVisible();
  await expect(conversation.getByText("-1").first()).toBeVisible();
  // The diff viewer tokenizes lines, so match a stable token fragment.
  await expect(conversation.getByText(/audit\('login'/).first()).toBeVisible();
});

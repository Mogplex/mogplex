import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  fulfillJson,
  mockBaseChrome,
} from "./helpers/automation-control-plane-fixtures";

// The rail renders at xl and up; Desktop Chrome's 1280 default is borderline.
test.use({ viewport: { width: 1440, height: 900 } });

test("control rail tabs switch between sandbox, diffs, outputs, and terminal", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockBaseChrome(page);
  await page.route("**/api/connections", (route) =>
    fulfillJson(route, { connections: [] })
  );
  await page.route("**/api/sandbox", (route) =>
    fulfillJson(route, {
      sandboxes: [
        {
          id: "rec-1",
          user_id: "00000000-0000-4000-8000-000000000001",
          repo_id: "repo-1",
          sandbox_id: "sbx_live123",
          base_branch: "main",
          working_branch: "feat/demo",
          limit_claim_id: null,
          status: "running",
          preview_url: "https://preview.example.vercel.app",
          snapshot_id: null,
          error: null,
          created_at: new Date().toISOString(),
          last_active_at: new Date().toISOString(),
        },
      ],
    })
  );

  const streamChunks = [
    { type: "start" },
    { type: "text-start", id: "t1" },
    { type: "text-delta", id: "t1", delta: "Starting the run now." },
    { type: "text-end", id: "t1" },
    {
      type: "tool-input-available",
      toolCallId: "call-1",
      toolName: "list_worktrees",
      input: { missionId: "MSN-1" },
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
    .fill("Run the tests");
  await page.getByRole("button", { name: "Start mission" }).click();

  // Terminal tab is the default and streams agent activity CLI-style.
  const rail = page.getByRole("complementary", { name: "Live rail" });
  const stream = rail.getByLabel("Agent activity stream");
  await expect(stream.getByText("> Run the tests")).toBeVisible();
  await expect(stream.getByText("Starting the run now.")).toBeVisible();
  await expect(stream.getByText("list_worktrees")).toBeVisible();

  // Sandbox tab shows the live sandbox record (not a stub).
  await rail.getByRole("button", { name: "Sandbox tab" }).click();
  await expect(rail.getByText("sbx_live123")).toBeVisible();
  await expect(rail.getByText("running")).toBeVisible();
  await expect(
    rail.getByRole("link", { name: /preview\.example\.vercel\.app/ })
  ).toBeVisible();
  await expect(rail.getByRole("button", { name: "Stop" })).toBeVisible();

  // Diffs and Outputs tabs have real (empty) states, not disabled stubs.
  await rail.getByRole("button", { name: "Diffs tab" }).click();
  await expect(rail.getByText(/No file changes yet/)).toBeVisible();

  await rail.getByRole("button", { name: "Outputs tab" }).click();
  await expect(rail.getByText(/No outputs yet/)).toBeVisible();

  await rail.getByRole("button", { name: "Terminal tab" }).click();
  await expect(stream.getByText("list_worktrees")).toBeVisible();
});

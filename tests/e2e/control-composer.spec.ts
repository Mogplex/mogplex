import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  fulfillJson,
  mockBaseChrome,
  modelId,
} from "./helpers/automation-control-plane-fixtures";

const shortModel = modelId.split("/").pop()!;

test("control composers expose permissions, model, and MCP controls without a spend cap", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockBaseChrome(page);

  // Registered after mockBaseChrome so it wins: the composer's model chip
  // must follow the account default from /api/models.
  await page.route("**/api/models", (route) =>
    fulfillJson(route, {
      models: [
        { id: modelId, context_length: 128000 },
        { id: "anthropic/claude-sonnet-5", context_length: 200000 },
      ],
      catalog: [
        { id: modelId, context_length: 128000, is_enabled: true },
        {
          id: "anthropic/claude-sonnet-5",
          context_length: 200000,
          is_enabled: true,
        },
      ],
      default_model: modelId,
    })
  );
  await page.route("**/api/connections", (route) =>
    fulfillJson(route, { connections: [] })
  );
  const chatRequests: Array<{
    messages?: Array<{
      role?: string;
      parts?: Array<{
        type: string;
        text?: string;
        filename?: string;
        mediaType?: string;
        url?: string;
      }>;
    }>;
    model?: string;
    mode?: string;
    permissions?: string;
    scope?: string;
    target?: string;
  }> = [];
  // A minimal but real UI message stream: text reply plus one tool call, so
  // the timeline's MOGPLEX and TOOL rendering is exercised end to end.
  const streamChunks = [
    { type: "start" },
    { type: "text-start", id: "t1" },
    { type: "text-delta", id: "t1", delta: "I can plan, delegate, and ship." },
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
  await page.route("**/api/control/chat", (route) => {
    chatRequests.push(
      route.request().postDataJSON() as (typeof chatRequests)[number]
    );
    return route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "x-vercel-ai-ui-message-stream": "v1",
      },
      body: streamBody,
    });
  });

  await page.goto(scopedPath("control"));
  await page.waitForLoadState("networkidle");

  // New-mission composer: permissions defaults to Skip Permissions (amber
  // warning), cycles to Approve Edits (blue), and no dollar spend-cap chip
  // exists anywhere.
  await expect(page.getByText("Describe the outcome")).toBeVisible();
  const permissionsChip = page.getByRole("button", {
    name: "Skip Permissions",
  });
  await expect(permissionsChip).toBeVisible();
  await expect(permissionsChip).toHaveClass(/accent-amber/);
  await expect(page.getByText(/\$\d+ cap/)).toHaveCount(0);
  await permissionsChip.click();
  const approveEditsChip = page.getByRole("button", { name: "Approve Edits" });
  await expect(approveEditsChip).toBeVisible();
  await expect(approveEditsChip).toHaveClass(/accent-blue/);
  await approveEditsChip.click();
  await expect(
    page.getByRole("button", { name: "Skip Permissions" })
  ).toBeVisible();

  // No manual plan-mode gate: the composer sends straight to the agent.
  await expect(page.getByRole("button", { name: "Plan mode" })).toHaveCount(0);
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "control-plan.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Prefer the smallest safe release plan."),
    });
  await expect(page.getByText("control-plan.txt")).toBeVisible();
  await page
    .getByPlaceholder("Ask anything or run a command...")
    .fill("Ship the new onboarding flow");
  await page.getByRole("button", { name: "Start mission" }).click();

  // The mission's first message behaves like chat: the agent's streamed reply
  // and tool call render in the timeline, with no fake dispatch card and no
  // budget line.
  await expect(page.getByText("I can plan, delegate, and ship.")).toBeVisible();
  await expect(page.getByText(/list_worktrees\(/)).toBeVisible();
  await expect(page.getByText(/Mogplex is planning/)).toHaveCount(0);
  await expect(page.getByText(/Budget: \$/)).toHaveCount(0);
  expect(chatRequests[0]).toMatchObject({
    mode: "run",
    permissions: "Skip Permissions",
    scope: "IMPLEMENT",
    target: "mission",
  });
  expect(chatRequests[0]?.messages?.at(-1)?.parts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "text",
        text: "Ship the new onboarding flow",
      }),
      expect.objectContaining({
        type: "file",
        filename: "control-plan.txt",
        mediaType: "text/plain",
      }),
    ])
  );
  const initialFilePart = chatRequests[0]?.messages
    ?.at(-1)
    ?.parts?.find((part) => part.type === "file");
  expect(initialFilePart?.url).toContain("data:text/plain");

  // Conversation composer: permissions chip, model chip preset to the account
  // default, and the MCP connections button are all present.
  const composerPermissions = page.getByRole("button", {
    name: "Skip Permissions",
  });
  await expect(composerPermissions).toBeVisible();
  const modelChip = page.getByRole("button", { name: shortModel, exact: true });
  await expect(modelChip).toBeVisible();
  const mcpButton = page.getByRole("button", { name: "Tools: 0" });
  await expect(mcpButton).toBeVisible();
  await mcpButton.click();
  await expect(page.getByRole("dialog", { name: "MCP servers" })).toBeVisible();
  await page.keyboard.press("Escape");

  // Switching models routes the chosen id through to the chat request body.
  await modelChip.click();
  await page.getByRole("button", { name: "anthropic/claude-sonnet-5" }).click();
  await expect(page.getByRole("button", { name: "Plan mode" })).toHaveCount(0);
  await page
    .getByPlaceholder("Direct Mogplex - it will delegate to agents")
    .fill("Summarize progress");
  await page.keyboard.press("Enter");

  await expect
    .poll(() => chatRequests.at(-1)?.model, { timeout: 10_000 })
    .toBe("anthropic/claude-sonnet-5");
  expect(chatRequests.at(-1)).toMatchObject({
    mode: "run",
    permissions: "Skip Permissions",
    scope: "IMPLEMENT",
    target: "mission",
  });

  await page
    .locator('input[type="file"]')
    .last()
    .setInputFiles({
      name: "attachment-only.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Attachment only\n\nNo prompt body."),
    });
  await expect(page.getByText("attachment-only.md")).toBeVisible();
  await page.getByRole("button", { name: "Send" }).click();

  await expect.poll(() => chatRequests.length, { timeout: 10_000 }).toBe(3);
  const attachmentOnlyRequest = chatRequests.at(-1);
  expect(attachmentOnlyRequest).toMatchObject({
    mode: "run",
    scope: "IMPLEMENT",
    target: "mission",
  });
  expect(attachmentOnlyRequest?.messages?.at(-1)?.parts).toEqual([
    expect.objectContaining({
      type: "file",
      filename: "attachment-only.md",
      mediaType: "text/markdown",
    }),
  ]);
});

test("control chat surfaces request failures instead of swallowing them", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockBaseChrome(page);
  await page.route("**/api/connections", (route) =>
    fulfillJson(route, { connections: [] })
  );
  await page.route("**/api/control/chat", (route) =>
    route.fulfill({ status: 500, body: "orchestrator unavailable" })
  );

  await page.goto(scopedPath("control"));
  await page.waitForLoadState("networkidle");

  await page
    .getByPlaceholder("Ask anything or run a command...")
    .fill("Ship something");
  await page.getByRole("button", { name: "Start mission" }).click();

  // The failed first send must produce a visible error, not silence.
  await expect(
    page.locator(".text-accent-amber").filter({ hasText: /./ }).first()
  ).toBeVisible();
});

test("control timeline renders agent markdown as formatted HTML", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockBaseChrome(page);
  await page.route("**/api/connections", (route) =>
    fulfillJson(route, { connections: [] })
  );

  // The agent's reply is markdown: a heading plus a GFM table. The timeline
  // must render it as HTML, not literal pipes and dashes.
  const agentMarkdown = [
    "## Tool overview",
    "",
    "| Tool | Purpose |",
    "| --- | --- |",
    "| read_file | Read a file from the repo |",
    "| write_file | Write content to a file |",
  ].join("\n");
  const streamChunks = [
    { type: "start" },
    { type: "text-start", id: "t1" },
    { type: "text-delta", id: "t1", delta: agentMarkdown },
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

  await page
    .getByPlaceholder("Ask anything or run a command...")
    .fill("List your tools");
  await page.getByRole("button", { name: "Start mission" }).click();

  await expect(
    page.getByRole("heading", { name: "Tool overview" }).first()
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Read a file from the repo" }).first()
  ).toBeVisible();
  await expect(
    page.getByRole("complementary", { name: "Artifacts" })
  ).toBeVisible();
  await expect(
    page
      .getByRole("complementary", { name: "Artifacts" })
      .getByRole("heading", {
        name: "Artifacts",
      })
  ).toBeVisible();
  await expect(
    page
      .getByRole("complementary", { name: "Artifacts" })
      .getByRole("heading", { name: "Tool overview" })
  ).toBeVisible();
  await expect(page.getByText("| --- |")).toHaveCount(0);
});

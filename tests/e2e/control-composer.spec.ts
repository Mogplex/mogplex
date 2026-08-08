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
    model?: string;
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

  // New-mission composer: permissions defaults to Skip Permissions, cycles to
  // Approve Edits, and no dollar spend-cap chip exists anywhere.
  await expect(page.getByText("Describe the outcome")).toBeVisible();
  const permissionsChip = page.getByRole("button", {
    name: "Skip Permissions",
  });
  await expect(permissionsChip).toBeVisible();
  await expect(page.getByText(/\$\d+ cap/)).toHaveCount(0);
  await permissionsChip.click();
  await expect(
    page.getByRole("button", { name: "Approve Edits" })
  ).toBeVisible();
  await page.getByRole("button", { name: "Approve Edits" }).click();
  await expect(
    page.getByRole("button", { name: "Skip Permissions" })
  ).toBeVisible();

  await page
    .getByPlaceholder("Describe what you want to achieve...")
    .fill("Ship the new onboarding flow");
  await page.getByRole("button", { name: "Start mission" }).click();

  // The mission's first message behaves like chat: the agent's streamed reply
  // and tool call render in the timeline, with no fake dispatch card and no
  // budget line.
  await expect(page.getByText("I can plan, delegate, and ship.")).toBeVisible();
  await expect(page.getByText(/list_worktrees\(/)).toBeVisible();
  await expect(page.getByText(/Mogplex is planning/)).toHaveCount(0);
  await expect(page.getByText(/Budget: \$/)).toHaveCount(0);

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
  await page
    .getByPlaceholder("Direct Mogplex - it will delegate to agents")
    .fill("Summarize progress");
  await page.keyboard.press("Enter");

  await expect
    .poll(() => chatRequests.at(-1)?.model, { timeout: 10_000 })
    .toBe("anthropic/claude-sonnet-5");
  expect(chatRequests.at(-1)).toMatchObject({
    permissions: "Skip Permissions",
    scope: "IMPLEMENT",
    target: "mission",
  });
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
    .getByPlaceholder("Describe what you want to achieve...")
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
    .getByPlaceholder("Describe what you want to achieve...")
    .fill("List your tools");
  await page.getByRole("button", { name: "Start mission" }).click();

  await expect(
    page.getByRole("heading", { name: "Tool overview" })
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Read a file from the repo" })
  ).toBeVisible();
  await expect(page.getByText("| --- |")).toHaveCount(0);
});

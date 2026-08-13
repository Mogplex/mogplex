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
  // One connected repo: the composer must default the session's project to it.
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
  const sessionCreates: Array<{
    title?: string;
    project?: string | null;
    repo_id?: string | null;
  }> = [];
  await page.route("**/api/control/sessions", (route) => {
    const request = route.request();
    if (request.method() !== "POST") return route.continue();
    const body = request.postDataJSON() as {
      title?: string;
      project?: string | null;
      repo_id?: string | null;
    };
    sessionCreates.push(body);
    return fulfillJson(route, {
      id: "sess-e2e-1",
      title: body.title ?? "Session",
      project: body.project ?? null,
      repo_id: body.repo_id ?? null,
      pinned: false,
      archived: false,
      created_at: "2026-08-11T00:00:00.000Z",
      updated_at: "2026-08-11T00:00:00.000Z",
      messages: [],
    });
  });
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
    conversationId?: string | null;
    missionId?: string | null;
    missionTitle?: string | null;
    repoId?: string | null;
    repoFullName?: string | null;
    repoOwner?: string | null;
    repoName?: string | null;
    repoBranch?: string | null;
    repoBaseBranch?: string | null;
    sandboxId?: string | null;
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
  // The session's project defaults to the connected repo.
  const projectPicker = page.getByLabel("Project", { exact: true });
  await expect(projectPicker).toBeVisible();
  await expect(projectPicker).toHaveAttribute("data-slot", "select-trigger");
  await expect(projectPicker).toContainText("acme/widgets");
  await projectPicker.click();
  await expect(
    page.getByRole("option", { name: "acme/widgets" })
  ).toBeVisible();
  await expect(
    page.getByRole("option", { name: "New project…" })
  ).toBeVisible();
  await page.keyboard.press("Escape");
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
  // budget line. (Scoped to the conversation log: the rail's terminal tab
  // mirrors the same activity as raw text.)
  const conversation = page.getByRole("log", { name: "Conversation" });
  await expect(
    conversation.getByText("I can plan, delegate, and ship.")
  ).toBeVisible();
  await expect(conversation.getByText(/list_worktrees\(/)).toBeVisible();
  await expect(page.getByText(/Mogplex is planning/)).toHaveCount(0);
  await expect(page.getByText(/Budget: \$/)).toHaveCount(0);
  expect(chatRequests[0]).toMatchObject({
    mode: "run",
    permissions: "Skip Permissions",
    scope: "IMPLEMENT",
    target: "mission",
    conversationId: "sess-e2e-1",
    repoId: "repo-1",
    repoFullName: "acme/widgets",
    repoOwner: "acme",
    repoName: "widgets",
    repoBranch: "main",
    repoBaseBranch: "main",
  });
  await expect(page).toHaveURL(/\/control\?mission=sess-e2e-1$/);
  await expect(
    conversation.getByText("I can plan, delegate, and ship.")
  ).toBeVisible();
  // The new session is tied to the repo's project.
  expect(sessionCreates).toHaveLength(1);
  expect(sessionCreates[0]).toMatchObject({
    project: "acme/widgets",
    repo_id: "repo-1",
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
    .getByPlaceholder("Ask for follow-up changes or attach images")
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
  await expect(
    page.getByRole("button", { name: "Attach file" }).last()
  ).toBeEnabled();

  await page.getByTestId("control-composer-dropzone").evaluate((element) => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(
      new File(["image bytes"], "dropped-screenshot.png", {
        type: "image/png",
      })
    );
    element.dispatchEvent(
      new DragEvent("drop", { bubbles: true, dataTransfer })
    );
  });
  await expect(page.getByText("dropped-screenshot.png")).toBeVisible();
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
      filename: "dropped-screenshot.png",
      mediaType: "image/png",
    }),
  ]);
});

test("control composer creates a new project when no repos are connected", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockBaseChrome(page);
  await page.route("**/api/connections", (route) =>
    fulfillJson(route, { connections: [] })
  );
  await page.route("**/api/repos", (route) => fulfillJson(route, []));
  const sessionCreates: Array<{
    title?: string;
    project?: string | null;
    repo_id?: string | null;
  }> = [];
  const chatRequests: Array<{
    conversationId?: string | null;
    missionId?: string | null;
    repoId?: string | null;
    repoBranch?: string | null;
    repoBaseBranch?: string | null;
  }> = [];
  await page.route("**/api/control/sessions", (route) => {
    const request = route.request();
    if (request.method() !== "POST") return route.continue();
    const body = request.postDataJSON() as {
      title?: string;
      project?: string | null;
      repo_id?: string | null;
    };
    sessionCreates.push(body);
    return fulfillJson(route, {
      id: "sess-e2e-new",
      title: body.title ?? "Session",
      project: body.project ?? null,
      repo_id: body.repo_id ?? null,
      pinned: false,
      archived: false,
      created_at: "2026-08-11T00:00:00.000Z",
      updated_at: "2026-08-11T00:00:00.000Z",
      messages: [],
    });
  });
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
      body: 'data: {"type":"start"}\n\ndata: [DONE]\n\n',
    });
  });

  await page.goto(scopedPath("control"));
  await page.waitForLoadState("networkidle");

  // With no repos the composer must create a project instead of leaving it unfiled.
  const projectPicker = page.getByLabel("Project", { exact: true });
  await expect(projectPicker).toHaveAttribute("data-slot", "select-trigger");
  await expect(projectPicker).toContainText("New project…");
  const nameInput = page.getByLabel("New project name");
  await expect(nameInput).toBeVisible();

  await page
    .getByPlaceholder("Ask anything or run a command...")
    .fill("Rebuild the analytics dashboard");
  await expect(nameInput).toHaveAttribute(
    "placeholder",
    "rebuild-the-analytics-dashboard"
  );
  await nameInput.fill("analytics-redesign");
  await page.getByRole("button", { name: "Start mission" }).click();

  await expect.poll(() => sessionCreates.length, { timeout: 10_000 }).toBe(1);
  await expect.poll(() => chatRequests.length, { timeout: 10_000 }).toBe(1);
  expect(sessionCreates[0]?.project).toBe("analytics-redesign");
  await page.getByRole("button", { name: /Worktrees/ }).click();
  await expect(
    page.getByText(/Account sandboxes are not shown as worktrees/)
  ).toBeVisible();
  expect(sessionCreates[0]?.repo_id).toBeNull();
  expect(chatRequests[0]).toMatchObject({
    conversationId: "sess-e2e-new",
    missionId: "sess-e2e-new",
    repoId: null,
    repoBranch: null,
    repoBaseBranch: null,
  });
  // The sidebar files the session under the new project group.
  await expect(
    page.getByRole("button", { name: /analytics-redesign/ })
  ).toBeVisible();
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
  await expect(
    page.getByRole("log", { name: "Conversation" }).getByText("| --- |")
  ).toHaveCount(0);
});

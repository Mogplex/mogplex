import type { UIMessage } from "ai";
import { expect, test } from "@playwright/test";
import { createPlanMissionTool } from "../../lib/agents/orchestrator/tools/planning-impl";
import {
  ctx,
  buildRun,
  buildSpec,
  buildTask,
  REPO_ID,
  type ExecutableTool,
} from "../support/control-plan-fixtures";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  fulfillJson,
  mockBaseChrome,
} from "./helpers/automation-control-plane-fixtures";

test("new work in an existing thread receives its own task while earlier work remains saved", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockBaseChrome(page);
  const oldSpec = buildSpec(0, "initial-review");
  const oldTask = buildTask(0, oldSpec);
  const savedTasks = [oldTask];
  const savedSpecs = [oldSpec];
  const planner = createPlanMissionTool(ctx, {
    getRunDetails: async () => ({
      run: buildRun(),
      specs: savedSpecs,
      tasks: savedTasks,
      events: [],
      mergeEvents: [],
    }),
    createPlan: async (input) =>
      input.tasks.map((item) => {
        const spec = buildSpec(item.orderIndex, item.slug);
        const task = buildTask(savedTasks.length, spec);
        savedSpecs.push(spec);
        savedTasks.push(task);
        return task;
      }),
  }) as unknown as ExecutableTool;
  const session = {
    id: "existing-thread",
    title: "Initial review",
    project: "acme/widgets",
    repo_id: REPO_ID,
    orchestration_run_id: ctx.orchestrationRunId,
    pinned: false,
    archived: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    messages: [
      {
        id: "earlier-request",
        role: "user",
        parts: [{ type: "text", text: "Review the initial change" }],
      },
      {
        id: "earlier-result",
        role: "assistant",
        parts: [{ type: "text", text: "Initial review saved." }],
      },
    ] as UIMessage[],
  };
  await page.route("**/api/control/sessions**", (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON() as { messages?: UIMessage[] };
      session.messages = body.messages ?? session.messages;
      session.updated_at = new Date().toISOString();
      return fulfillJson(route, { ok: true, session });
    }
    return fulfillJson(
      route,
      new URL(route.request().url()).searchParams.has("id")
        ? session
        : [session]
    );
  });
  await page.route("**/api/repos", (route) =>
    fulfillJson(route, [
      { id: REPO_ID, full_name: "acme/widgets", default_branch: "main" },
    ])
  );
  await page.route("**/api/sandbox", (route) =>
    fulfillJson(route, { sandboxes: [] })
  );
  await page.route("**/api/control/worktrees**", (route) =>
    fulfillJson(route, { worktrees: [], workers: [] })
  );
  await page.route("**/api/connections", (route) =>
    fulfillJson(route, { connections: [] })
  );
  await page.route("**/api/control/chat", async (route) => {
    const result = (await planner.execute({
      objective: "Review the follow-up",
      tasks: [
        {
          slug: "follow-up",
          title: "Follow-up",
          prompt: "Review the documentation",
          harness: "codex",
          ownedPaths: ["docs"],
        },
      ],
    })) as { status: string; tasks: typeof savedTasks };
    const chunks = [
      { type: "start" },
      { type: "text-start", id: "reply" },
      {
        type: "text-delta",
        id: "reply",
        delta: `Task ready: ${result.tasks.map((task) => task.branch_name).join(", ")}`,
      },
      { type: "text-end", id: "reply" },
      { type: "finish" },
    ];
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "x-vercel-ai-ui-message-stream": "v1",
      },
      body:
        chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") +
        "data: [DONE]\n\n",
    });
  });
  await page.goto(scopedPath("control?mission=existing-thread"));
  await page
    .getByRole("textbox", { name: "Ask for follow-up changes" })
    .fill("Review the new documentation");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    page.getByText("Task ready: mogplex/task/separate-worktrees/follow-up", {
      exact: true,
    })
  ).toBeVisible();
  expect(savedTasks).toHaveLength(2);
  expect(savedTasks[0]).toEqual(oldTask);
  await expect(page).toHaveURL(/mission=existing-thread/);
  await page
    .getByRole("button", { name: "Earlier conversation · 1 request" })
    .click();
  await expect(
    page.getByText("Initial review saved.", { exact: true })
  ).toBeVisible();
});

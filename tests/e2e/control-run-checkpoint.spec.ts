import { expect, test } from "@playwright/test";
import { setupControlSidebar } from "./helpers/control-sidebar-fixture";
import type { RunWorkspaceContext } from "@/lib/run-workspace/types";

for (const action of ["approve", "revise"] as const) {
  test(`saved Slack plan can ${action} in Command Center after a completed planning pass`, async ({
    page,
  }) => {
    const { sessions } = await setupControlSidebar(page);
    const runId = "00000000-0000-4000-8000-000000000901";
    const aiCallId = "00000000-0000-4000-8000-000000000902";
    sessions[0].external_run_id = runId;
    const context: RunWorkspaceContext = {
      runId,
      aiCallId,
      prompt: "Research and plan a welcome page",
      status: "awaiting_input",
      sandboxRecordId: null,
      workingBranch: "fix/welcome",
      canGuide: true,
      checkpoint: {
        kind: "plan",
        summary: "Add a welcoming heading and test mobile layout.",
      },
      repo: {
        id: "repo-1",
        user_id: "owner",
        full_name: "acme/widgets",
        created_at: "2026-09-05T00:00:00Z",
      },
    };
    await page.route("**/api/runs/*/workspace", (route) =>
      route.fulfill({ json: context })
    );
    let streams = 0;
    await page.route("**/api/runs/*/stream?*", (route) => {
      streams++;
      return route.fulfill({
        contentType: "text/event-stream",
        body: `event: run\ndata: ${JSON.stringify(context)}\n\nevent: finished\ndata: ${JSON.stringify({ id: "done", type: "finished", toolName: null, message: "Planning pass finished", payload: {}, createdAt: "2026-09-05T00:00:01Z" })}\n\nevent: replay_complete\ndata: {}\n\n`,
      });
    });
    const submissions: unknown[] = [];
    let fail = action === "revise";
    await page.route("**/api/runs/*/checkpoint", async (route) => {
      submissions.push(route.request().postDataJSON());
      if (fail) {
        fail = false;
        return route.fulfill({
          status: 500,
          json: { error: "Could not confirm your response. Try again." },
        });
      }
      context.status = "streaming";
      context.aiCallId = "00000000-0000-4000-8000-000000000903";
      context.checkpoint = null;
      return route.fulfill({ status: 202, json: { status: "queued" } });
    });
    if (action === "revise")
      await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    const conversation = page.getByTestId("control-external-run");
    await expect(
      conversation.getByText("Waiting for input", { exact: true })
    ).toBeVisible();
    await expect(
      conversation.getByText(context.checkpoint!.summary, { exact: true })
    ).toBeVisible();
    await expect(
      conversation.getByRole("button", { name: "Continue in this chat" })
    ).toHaveCount(0);
    expect(submissions).toEqual([]);
    await page.reload();
    if (action === "revise") {
      await conversation
        .getByRole("button", { name: "Revise plan", exact: true })
        .click();
      const feedback = conversation.getByRole("textbox", {
        name: "Plan feedback",
      });
      await feedback.fill("Keep the existing colors");
      await conversation.getByRole("button", { name: "Send feedback" }).click();
      await expect(conversation.getByRole("alert")).toContainText(
        "Could not confirm"
      );
      await expect(feedback).toHaveValue("Keep the existing colors");
      await conversation.getByRole("button", { name: "Send feedback" }).click();
    } else {
      await conversation
        .getByRole("button", { name: "Approve plan", exact: true })
        .click();
    }
    await expect(
      conversation.getByText("Agent is working", { exact: true })
    ).toBeVisible();
    await expect(
      conversation.getByRole("textbox", { name: "Guide this run" })
    ).toBeVisible();
    expect(submissions.at(-1)).toEqual({
      aiCallId,
      action,
      ...(action === "revise" ? { feedback: "Keep the existing colors" } : {}),
    });
    expect(submissions).toHaveLength(action === "revise" ? 2 : 1);
    await expect.poll(() => streams).toBeGreaterThanOrEqual(3);
  });
}

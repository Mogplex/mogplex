import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  fulfillJson,
  initializeTrackedEvents,
  mockActivationFlow,
  syncedRepo,
} from "./helpers/activation-fixtures";
import { buildSandboxFixture } from "./helpers/sandbox-fixtures";

for (const sandboxStatus of ["running", "paused", "stopped"]) {
  test(`View work opens ${sandboxStatus} workspace, streams chat, and reloads history without launching work`, async ({
    page,
  }, testInfo) => {
    await initializeTrackedEvents(page);
    await enableScopedE2EAuth(page);
    await mockActivationFlow(page, { initialRepos: [syncedRepo] });
    const runId = "00000000-0000-4000-8000-000000000901";
    const context = {
      runId,
      aiCallId: "call-1",
      prompt: "Fix overlapping mobile canvas controls",
      status: "streaming",
      sandboxRecordId: "sandbox-record-repo-1",
      workingBranch: "fix/mobile",
      canGuide: true,
      repo: {
        ...syncedRepo,
        user_id: "user-1",
        created_at: "2026-09-05T00:00:00Z",
      },
    };
    let terminal = false;
    let resumeId: string | undefined;
    let launches = 0;
    let chats = 0;
    let guidance: unknown;
    let savedConversation: unknown;
    await page.route(/\/api\/conversations(?:\?.*)?$/, async (route) => {
      if (route.request().method() === "PUT")
        savedConversation = route.request().postDataJSON();
      await route.fallback();
    });
    await page.route("**/api/runs/*/workspace", (route) =>
      fulfillJson(route, {
        ...context,
        status: terminal ? "failed" : "streaming",
      })
    );
    const event = (id: string, type: string, message: string, payload = {}) =>
      `id: ${id}\nevent: ${type}\ndata: ${JSON.stringify({ id, type, message, payload, toolName: "bash", createdAt: "2026-09-05T00:00:00Z" })}\n\n`;
    const history =
      event("e1", "log", "I found the mobile header overlap.", {
        kind: "assistant_delta",
      }) +
      event("e2", "tool_started", "bash started", { toolCallId: "tool-1" });
    await page.route("**/api/runs/*/stream", async (route) => {
      resumeId = route.request().headers()["last-event-id"];
      await route.fulfill({
        contentType: "text/event-stream",
        body:
          `event: run\ndata: ${JSON.stringify(context)}\n\n` +
          (resumeId ? "" : history) +
          (terminal
            ? event("e3", "failed", "Run stopped")
            : "event: replay_complete\ndata: {}\n\n"),
      });
    });
    await page.route("**/api/runs/*/guidance", async (route) => {
      guidance = route.request().postDataJSON();
      await fulfillJson(route, { id: "receipt", status: "received" });
    });
    const sandbox = {
      ...buildSandboxFixture({
        repoId: "repo-1",
        billingSource: "platform",
        status: sandboxStatus,
        healthStatus: sandboxStatus,
        previewUrl: new URL(
          "/__e2e/preview/repo-1",
          testInfo.project.use.baseURL
        ).toString(),
      }),
      working_branch: "fix/mobile",
      snapshot_id: sandboxStatus === "paused" ? "saved-snapshot" : null,
    };
    await page.route("**/api/sandbox/sandbox-record-repo-1/health", (route) =>
      fulfillJson(route, { health: { status: sandboxStatus }, sandbox })
    );
    await page.route("**/api/sandbox/sandbox-record-repo-1", (route) =>
      fulfillJson(route, { sandbox })
    );
    await page.route(/\/api\/sandbox(?:\?.*)?$/, async (route) => {
      if (route.request().method() === "GET")
        await fulfillJson(route, { sandboxes: [sandbox] });
      else {
        launches++;
        await route.abort();
      }
    });
    await page.route("**/api/sandbox/restart", async (route) => {
      launches++;
      await route.abort();
    });
    await page.route(/\/api\/chat(?:\?.*)?$/, async (route) => {
      chats++;
      await route.abort();
    });
    await page.goto(scopedPath(`projects/workspace?run=${runId}`));
    await expect(
      page.getByText("Workspace Chat · demo-app", { exact: true })
    ).toBeVisible();
    await expect(page.getByText("Live Preview", { exact: true })).toBeVisible();
    if (sandboxStatus === "running")
      await expect(
        page
          .frameLocator("iframe")
          .getByRole("heading", { name: "Demo Preview" })
      ).toBeVisible();
    if (sandboxStatus === "paused")
      await expect(
        page.getByText("Sandbox Paused", { exact: true })
      ).toBeVisible();
    await expect(
      page.getByText("Terminal", { exact: true }).first()
    ).toBeVisible();
    await expect(
      page.getByText("I found the mobile header overlap.", { exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /bash.*running/ })
    ).toBeVisible();
    await page
      .getByRole("textbox", { name: "Guide this run" })
      .fill("Keep desktop behavior unchanged");
    await page
      .getByRole("button", { name: "Send guidance", exact: true })
      .click();
    await expect(page.getByText(/Guidance saved/)).toBeVisible();
    expect(guidance).toMatchObject({ text: "Keep desktop behavior unchanged" });
    terminal = true;
    await expect(page.getByText("Run failed", { exact: true })).toBeVisible();
    expect(resumeId).toBe("e2");
    await expect(
      page.getByRole("button", { name: /bash.*error/ })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /bash.*running/ })
    ).toHaveCount(0);
    await page.reload();
    await expect(page.getByText("Run failed", { exact: true })).toBeVisible();
    await expect(
      page.getByText("I found the mobile header overlap.", { exact: true })
    ).toBeVisible();
    const sessions = await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("mogplex-sessions") ?? "{}").state
          .sessions
    );
    expect(
      sessions.filter(
        (session: { externalRunId?: string }) => session.externalRunId === runId
      )
    ).toHaveLength(1);
    expect(launches).toBe(0);
    expect(chats).toBe(0);
    await page.screenshot({
      path: testInfo.outputPath("run-workspace.png"),
      fullPage: true,
    });
    if (sandboxStatus === "running") {
      await page
        .getByRole("button", { name: "Continue in workspace chat" })
        .click();
      await expect(
        page.getByRole("textbox", {
          name: "Ask the agent what to build, fix, or explain. Type / for commands or drop files here.",
        })
      ).toBeVisible();
      expect(savedConversation).toMatchObject({
        repo_id: "repo-1",
        sandbox_id: "sandbox-record-repo-1",
      });
      expect(chats).toBe(0);
    }
  });
}

test("an inaccessible run does not fall through to another workspace", async ({
  page,
}) => {
  await initializeTrackedEvents(page);
  await enableScopedE2EAuth(page);
  await mockActivationFlow(page);
  await page.route("**/api/runs/*/workspace", (route) =>
    route.fulfill({ status: 404, json: { error: "Run not found" } })
  );
  await page.goto(scopedPath("projects/workspace?run=missing"));
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Run not found or you do not have access." })
  ).toBeVisible();
  await expect(page.getByText("Live Preview", { exact: true })).toHaveCount(0);
});

test("continuing a completed run waits for its delayed recorded history", async ({
  page,
}) => {
  await initializeTrackedEvents(page);
  await enableScopedE2EAuth(page);
  await mockActivationFlow(page, { initialRepos: [syncedRepo] });
  const runId = "00000000-0000-4000-8000-000000000903";
  await page.route("**/api/runs/*/workspace", (route) =>
    fulfillJson(route, {
      runId,
      aiCallId: "call-delayed",
      prompt: "Fix mobile controls",
      status: "success",
      sandboxRecordId: null,
      workingBranch: "fix/mobile",
      canGuide: false,
      repo: {
        ...syncedRepo,
        user_id: "user-1",
        created_at: "2026-09-05T00:00:00Z",
      },
    })
  );
  let releaseReplay = () => {};
  const replayGate = new Promise<void>((resolve) => {
    releaseReplay = resolve;
  });
  let savedConversation:
    | { messages?: { parts: { type: string; text?: string }[] }[] }
    | undefined;
  await page.route(/\/api\/conversations(?:\?.*)?$/, async (route) => {
    if (route.request().method() === "PUT")
      savedConversation = route.request().postDataJSON();
    await route.fallback();
  });
  await page.route("**/api/runs/*/stream", async (route) => {
    await replayGate;
    const event = (id: string, type: string, message: string, payload = {}) =>
      `id: ${id}\nevent: ${type}\ndata: ${JSON.stringify({ id, type, message, payload, toolName: null, createdAt: "2026-09-05T00:00:00Z" })}\n\n`;
    await route.fulfill({
      contentType: "text/event-stream",
      body:
        'event: run\ndata: {"status":"success"}\n\n' +
        event(
          "report",
          "log",
          "Fixed the mobile overlap and verified desktop.",
          { kind: "assistant_final" }
        ) +
        // The production stream closes at the terminal event without replay_complete.
        event("done", "finished", "Completed"),
    });
  });
  try {
    await page.goto(scopedPath(`projects/workspace?run=${runId}`));
    await expect(page.getByText("Run complete", { exact: true })).toBeVisible();
    const continueButton = page.getByRole("button", {
      name: "Continue in workspace chat",
    });
    await expect(continueButton).toBeDisabled();
    expect(savedConversation).toBeUndefined();
    releaseReplay();
    await expect(
      page.getByText("Fixed the mobile overlap and verified desktop.", {
        exact: true,
      })
    ).toBeVisible();
    await expect(continueButton).toBeEnabled();
    await continueButton.click();
    await expect(
      page.getByRole("textbox", {
        name: "Ask the agent what to build, fix, or explain. Type / for commands or drop files here.",
      })
    ).toBeVisible();
    expect(JSON.stringify(savedConversation)).toContain(
      "Fixed the mobile overlap and verified desktop."
    );
  } finally {
    releaseReplay();
  }
});

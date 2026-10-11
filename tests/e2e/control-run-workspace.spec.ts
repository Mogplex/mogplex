import { expect, test } from "@playwright/test";
import { mockControlWorkspace } from "./helpers/control-workspace-fixture";
import { scopedPath } from "./helpers/auth";

for (const switchTask of [false, true]) {
  test(`Slack continuation ${switchTask ? "preserves a newer task selection" : "keeps its exact sandbox and recorded history"}`, async ({
    page,
  }) => {
    const { sessions, mutations } = await mockControlWorkspace(page);
    const runId = "00000000-0000-4000-8000-000000000901";
    sessions[0].external_run_id = runId;
    sessions[0].messages = [];
    let release!: () => void;
    const history = new Promise<void>((resolve) => {
      release = resolve;
    });
    let finishContinuation!: () => void;
    const continuationResponse = new Promise<void>((resolve) => {
      finishContinuation = resolve;
    });
    let continues = 0;
    let starts = 0;
    page.on("request", (req) => {
      if (
        req.method() === "POST" &&
        /\/api\/(control\/chat|v1\/mogplex\/runs)$/.test(
          new URL(req.url()).pathname
        )
      )
        starts++;
    });
    await page.route("**/api/control/runs/*", async (route) => {
      if (route.request().postDataJSON()?.continue) {
        continues++;
        if (switchTask) await continuationResponse;
        sessions[0].messages = [
          {
            id: "prompt",
            role: "user",
            parts: [{ type: "text", text: "Refresh the welcome page" }],
          },
          {
            id: "final",
            role: "assistant",
            parts: [{ type: "text", text: "Verified the welcome update." }],
          },
        ];
      }
      return route.fulfill({ json: sessions[0] });
    });
    await page.route("**/api/runs/*/workspace", (route) =>
      route.fulfill({
        json: {
          runId,
          aiCallId: "call",
          status: "success",
          prompt: "Refresh the welcome page",
          sandboxRecordId: "sandbox-two",
          workingBranch: "work/two",
          canGuide: false,
          repo: {
            id: "repo-widgets",
            user_id: "user",
            full_name: "acme/widgets",
            default_branch: "main",
            created_at: "2026-10-10T12:00:00Z",
          },
        },
      })
    );
    await page.route("**/api/runs/*/stream?*", async (route) => {
      await history;
      await route.fulfill({
        contentType: "text/event-stream",
        body: 'event: run\ndata: {"status":"success"}\n\nevent: log\ndata: {"id":"final","type":"log","toolName":null,"message":"Verified the welcome update.","payload":{"kind":"assistant_final"},"createdAt":"2026-10-10T12:00:00Z"}\n\nevent: replay_complete\ndata: {}\n\n',
      });
    });
    try {
      await page.goto(scopedPath(`control?run=${runId}`));
      const continuation = page.getByRole("button", {
        name: "Continue in this chat",
      });
      await expect(continuation).toBeDisabled();
      await page
        .getByRole("button", { name: "Open preview", exact: true })
        .click();
      await expect(
        page
          .getByRole("complementary", { name: "Task tools" })
          .locator("iframe")
      ).toHaveAttribute("src", /preview\.example\.test\/two/);
      await page.getByRole("button", { name: "Close task tools" }).click();
      release();
      await expect(continuation).toBeEnabled();
      await expect(
        page.getByRole("log", { name: "Conversation" })
      ).toContainText("Verified the welcome update.");
      await continuation.click();
      if (switchTask) {
        await page
          .getByRole("button", { name: /^Review billing flow/ })
          .click();
        await expect(page).toHaveURL(/mission=task-two/);
        const response = page.waitForResponse(
          (res) =>
            res.url().includes(`/api/control/runs/${runId}`) &&
            res.request().postDataJSON()?.continue === true
        );
        finishContinuation();
        await response;
        await page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve))
            )
        );
        await expect(page).toHaveURL(/mission=task-two/);
        await expect(page.getByRole("banner")).toContainText(
          "Review billing flow"
        );
        expect(continues).toBe(1);
        expect(starts).toBe(0);
        return;
      }
      await expect(page.getByTestId("control-external-run")).toHaveCount(0);
      await expect(
        page.getByRole("log", { name: "Conversation" })
      ).toContainText("Verified the welcome update.");
      await expect(page).toHaveURL(/mission=task-one/);
      await page.reload();
      await expect(page.getByTestId("control-external-run")).toHaveCount(0);
      await expect(
        page.getByRole("log", { name: "Conversation" })
      ).toContainText("Verified the welcome update.");
      await page
        .getByRole("button", { name: "Open preview", exact: true })
        .click();
      await expect(
        page
          .getByRole("complementary", { name: "Task tools" })
          .locator("iframe")
      ).toHaveAttribute("src", /preview\.example\.test\/two/);
      expect(continues).toBe(1);
      expect(starts).toBe(0);
      expect(mutations).toEqual([]);
    } finally {
      release();
      finishContinuation();
    }
  });
}

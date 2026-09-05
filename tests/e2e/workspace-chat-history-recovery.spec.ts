import { expect, test } from "@playwright/test";
import type { UIMessage } from "ai";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  fulfillJson,
  initializeTrackedEvents,
  mockActivationFlow,
  modelId,
} from "./helpers/activation-fixtures";
import { buildSandboxBackedCall } from "./helpers/sandbox-fixtures";

test("reloaded history reconciles a terminal run without replaying or losing completed results", async ({
  page,
}) => {
  await initializeTrackedEvents(page);
  await enableScopedE2EAuth(page);
  await mockActivationFlow(page);
  let savedMessages: UIMessage[] = [
    {
      id: "saved-response",
      role: "assistant",
      metadata: { ai_call_id: "saved-call" },
      parts: [
        { type: "text", text: "Checking the project", state: "done" },
        {
          type: "tool-bash",
          toolCallId: "completed",
          state: "output-available",
          input: { command: "pwd" },
          output: "preserved result",
        },
        {
          type: "tool-bash",
          toolCallId: "unfinished",
          state: "input-available",
          input: { command: "check-project" },
        },
      ],
    },
  ];
  let conversationId: string | null = null;
  let chatRequests = 0;
  let resolveSaved!: () => void;
  const recoveredSaved = new Promise<void>((resolve) => {
    resolveSaved = resolve;
  });
  await page.route(/\/api\/chat(?:\?.*)?$/, async (route) => {
    chatRequests += 1;
    await route.abort();
  });
  await page.route(/\/api\/conversations(?:\?.*)?$/, async (route) => {
    const request = route.request();
    const id = new URL(request.url()).searchParams.get("id");
    if (request.method() === "GET" && id) {
      conversationId = id;
      await fulfillJson(route, {
        id,
        repo_id: "repo-1",
        model: modelId,
        mode: "AUTO",
        messages: savedMessages,
        local_msgs: [],
        title: "Saved check",
      });
    } else if (request.method() === "PUT") {
      const body = request.postDataJSON() as {
        id: string;
        messages: UIMessage[];
      };
      savedMessages = body.messages;
      if (
        body.messages.some((message) =>
          message.parts.some(
            (part) =>
              part.type === "tool-bash" &&
              part.toolCallId === "unfinished" &&
              part.state === "output-error"
          )
        )
      )
        resolveSaved();
      await fulfillJson(route, { ok: true, conversation: body });
    } else await fulfillJson(route, []);
  });
  await page.route("**/api/observability/calls?*", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    const call = {
      ...buildSandboxBackedCall({
        repoId: "repo-1",
        sandboxRecordId: "sandbox-record-repo-1",
        sandboxId: "sandbox-1",
        previewUrl: null,
        computeBillingSource: "platform",
        billingProjectId: null,
        billingTeamId: null,
        aiBillingSource: "platform",
        callId: "saved-call",
      }),
      status: "failed",
      conversation_id: conversationId,
    };
    const calls =
      params.get("conversation_id") === conversationId &&
      params.get("live_only") !== "true"
        ? [call]
        : [];
    await fulfillJson(route, {
      calls,
      total: calls.length,
      page: 1,
      limit: 100,
    });
  });
  await page.goto(scopedPath("projects/workspace"));
  await page.getByTestId("home-sync-repos").click();
  await page.getByTestId("home-open-workspace-repo-1").click();
  const failedTool = page.getByRole("button", { name: /bash.*error/ });
  await expect(failedTool).toBeVisible();
  await expect(page.getByText("running...", { exact: true })).toHaveCount(0);
  await failedTool.click();
  await expect(
    page.getByText(/No completion result was received/)
  ).toBeVisible();
  await page.getByRole("button", { name: /bash.*done/ }).click();
  await expect(page.getByText("preserved result")).toBeVisible();
  await recoveredSaved;
  await page.reload();
  await expect(failedTool).toBeVisible();
  await expect(page.getByText("running...", { exact: true })).toHaveCount(0);
  expect(chatRequests).toBe(0);
});

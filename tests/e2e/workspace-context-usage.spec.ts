import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth } from "./helpers/auth";
import {
  connectedUser,
  initializeTrackedEvents,
  mockActivationFlow,
  modelId,
} from "./helpers/activation-fixtures";

for (const width of [1280, 390]) {
  test(`workspace shows measured context and preserves it after reload (${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await initializeTrackedEvents(page);
    await enableScopedE2EAuth(page);
    await mockActivationFlow(page);
    await page.route(/\/api\/chat(?:\?.*)?$/, async (route) => {
      const chunks = [
        {
          type: "start",
          messageId: "measured-answer",
          messageMetadata: { ai_call_id: "call-context" },
        },
        { type: "text-start", id: "text" },
        { type: "text-delta", id: "text", delta: "Measured context reply." },
        { type: "text-end", id: "text" },
        {
          type: "message-metadata",
          messageMetadata: {
            ai_call_id: "call-context",
            context: { model: modelId, inputTokens: 25000, outputTokens: 600 },
          },
        },
        { type: "finish", finishReason: "stop" },
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
    await page.goto(`/${connectedUser.username}/projects/workspace`);
    await page.getByTestId("home-sync-repos").click();
    await page.getByTestId("home-open-workspace-repo-1").click();
    await expect(
      page.getByText("Context: unknown", { exact: true })
    ).toBeVisible();
    const saved = page.waitForResponse(
      (response) =>
        response.url().includes("/api/conversations") &&
        response.request().method() === "PUT" &&
        (response.request().postData() ?? "").includes('"inputTokens":25000')
    );
    const prompt = page.getByPlaceholder(
      "Ask the agent what to build, fix, or explain. Type / for commands or drop files here."
    );
    await prompt.fill("Check context usage");
    await prompt.press("Enter");
    await expect(
      page.getByText("Context: 20% used", { exact: true })
    ).toBeVisible();
    await expect(
      page.getByText("Context: 20% used", { exact: true })
    ).toHaveAttribute("title", /Last model step: 25,600 of 128,000 tokens/);
    await saved;
    await page.reload();
    await page.waitForLoadState("networkidle");
    if (await page.getByTestId("home-open-workspace-repo-1").isVisible())
      await page.getByTestId("home-open-workspace-repo-1").click();
    await expect(
      page.getByText("Context: 20% used", { exact: true })
    ).toBeVisible();
  });
}

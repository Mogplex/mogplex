import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  fulfillJson,
  mockBaseChrome,
  mockControlSessionBootstrap,
  modelId,
} from "./helpers/automation-control-plane-fixtures";

test("context reflects one model step, not cumulative billing usage", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockBaseChrome(page);
  await mockControlSessionBootstrap(page);
  await page.route("**/api/control/usage?*", (route) =>
    fulfillJson(route, {
      inputTokens: 2_000_000,
      outputTokens: 50_000,
      costUsd: 1,
    })
  );
  await page.route("**/api/control/chat", (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      headers: { "x-vercel-ai-ui-message-stream": "v1" },
      body:
        [
          {
            type: "start",
            messageMetadata: {
              ai_call_id: "00000000-0000-4000-8000-000000000001",
            },
          },
          { type: "text-start", id: "answer" },
          {
            type: "text-delta",
            id: "answer",
            delta: "Ready for your next request.",
          },
          { type: "text-end", id: "answer" },
          {
            type: "message-metadata",
            messageMetadata: {
              context: {
                model: modelId,
                inputTokens: 10_000,
                outputTokens: 240,
              },
            },
          },
          { type: "finish", finishReason: "stop" },
        ]
          .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
          .join("") + "data: [DONE]\n\n",
    })
  );
  await page.goto(scopedPath("control"));
  await page
    .getByPlaceholder("Ask anything or run a command...")
    .fill("check this repo");
  await page.getByRole("button", { name: "Start mission" }).click();
  await expect(
    page.getByText("Ready for your next request.", { exact: true })
  ).toBeVisible();
  await expect(page.getByLabel("Context usage")).toHaveAttribute(
    "title",
    /8%.*10,240/
  );
  await expect(page.getByLabel("Context usage")).not.toContainText("100");
});

import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  fulfillJson,
  mockBaseChrome,
  mockControlSessionBootstrap,
} from "./helpers/automation-control-plane-fixtures";

test("a conversation conflict reloads the remote turn and keeps the rejected draft without resending", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockBaseChrome(page);
  await mockControlSessionBootstrap(page);
  await page.route("**/api/connections", (route) =>
    fulfillJson(route, { connections: [] })
  );
  let posts = 0;
  let conflictReads = 0;
  await page.route("**/api/control/chat", (route) => {
    posts++;
    if (posts > 1)
      return fulfillJson(
        route,
        { error: "A turn is already running on this conversation." },
        409
      );
    return route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      headers: { "x-vercel-ai-ui-message-stream": "v1" },
      body: 'data: {"type":"start","messageId":"first"}\n\ndata: {"type":"finish"}\n\ndata: [DONE]\n\n',
    });
  });
  await page.route("**/api/control/sessions?id=**", (route) => {
    if (posts < 2) return route.fallback();
    conflictReads++;
    return fulfillJson(route, {
      id: "session-control-default",
      messages: [
        {
          id: "remote",
          role: "assistant",
          parts: [
            {
              type: "text",
              text: "The other tab is already working on this mission.",
            },
          ],
        },
      ],
    });
  });
  await page.goto(scopedPath("/control"));
  await page
    .getByPlaceholder("Ask anything or run a command...")
    .fill("Start a conversation");
  await page.getByRole("button", { name: "Start mission" }).click();
  const composer = page.getByPlaceholder(
    "Ask for follow-up changes or attach images"
  );
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
  await composer.fill("Keep my rejected draft");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(
    page.getByText("A turn is already running on this conversation.", {
      exact: true,
    })
  ).toBeVisible();
  await expect(
    page.getByText("The other tab is already working on this mission.", {
      exact: true,
    })
  ).toBeVisible();
  await expect(composer).toHaveValue("Keep my rejected draft");
  expect(posts).toBe(2);
  expect(conflictReads).toBeGreaterThan(0);
});

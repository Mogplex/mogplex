import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth } from "./helpers/auth";
import {
  connectedUser,
  mockActivationFlow,
} from "./helpers/activation-fixtures";
import { capturePageErrors } from "./helpers/page-errors";

for (const unavailable of [false, true]) {
  test(`workspace /agent shows ${unavailable ? "a safe error" : "server summaries"} on demand`, async ({
    page,
  }) => {
    const errors = capturePageErrors(page);
    await enableScopedE2EAuth(page);
    await mockActivationFlow(page);
    let summaryRequests = 0;
    let chatRequests = 0;
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/agents/templates")
        summaryRequests += 1;
      if (
        request.method() === "POST" &&
        /\/api\/(?:agent\/run|chat|control\/chat)$/.test(
          new URL(request.url()).pathname
        )
      )
        chatRequests += 1;
    });
    if (unavailable) {
      await page.route("**/api/agents/templates", (route) =>
        route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "private summary diagnostic" }),
        })
      );
    }
    await page.goto(`/${connectedUser.username}/projects/workspace`);
    await page.getByTestId("home-sync-repos").click();
    await page.getByTestId("home-open-workspace-repo-1").click();
    const composer = page.getByRole("textbox", {
      name: "Ask the agent what to build, fix, or explain. Type / for commands or drop files here.",
    });
    await expect(composer).toBeEnabled();
    expect(summaryRequests).toBe(0);
    await composer.fill("/agent supabase");
    const response = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/agents/templates"
    );
    await composer.press("Enter");
    const result = await response;
    if (unavailable) {
      await expect(
        page.getByText("Unable to load agent templates. Try again.")
      ).toBeVisible();
      await expect(page.getByText("private summary diagnostic")).toHaveCount(0);
    } else {
      expect(result.ok()).toBe(true);
      const data: unknown = await result.json();
      expect(JSON.stringify(data)).not.toContain("system_prompt");
      await expect(
        page.getByText(
          /SUPABASE-PATTERNS\s+PostgREST, RLS policies, Realtime, auth helpers/
        )
      ).toBeVisible();
    }
    expect(summaryRequests).toBe(1);
    expect(chatRequests).toBe(0);
    expect(errors).toEqual([]);
  });
}

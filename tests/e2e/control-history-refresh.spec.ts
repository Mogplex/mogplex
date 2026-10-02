import { expect, test } from "@playwright/test";
import { scopedPath } from "./helpers/auth";
import { fulfillJson } from "./helpers/automation-control-plane-fixtures";
import {
  mockRecoveryChrome,
  recoverySession,
} from "./helpers/control-recovery-fixtures";

for (const newChat of [false, true]) {
  test(`failed background history refresh keeps loaded chats usable in ${newChat ? "a new chat" : "the current chat"}`, async ({
    page,
  }) => {
    await mockRecoveryChrome(page);
    await page.addInitScript(() => {
      const sources: EventSource[] = [];
      Object.defineProperty(window, "recoveryEventSources", { value: sources });
      const NativeEventSource = window.EventSource;
      window.EventSource = class extends NativeEventSource {
        constructor(url: string | URL, options?: EventSourceInit) {
          super(url, options);
          sources.push(this);
        }
      };
    });
    let failed = false;
    await page.route("**/api/control/sessions**", (route) => {
      const id = new URL(route.request().url()).searchParams.get("id");
      return fulfillJson(
        route,
        id
          ? recoverySession
          : failed
            ? { error: "Could not refresh chats. Try again." }
            : [recoverySession],
        !id && failed ? 500 : 200
      );
    });
    await page.goto(`${scopedPath("control")}?mission=${recoverySession.id}`);
    await expect(
      page.getByText("Saved request", { exact: true })
    ).toBeVisible();
    const sidebar = page.getByRole("complementary", { name: "Sessions" });
    const row = sidebar.getByRole("button", { name: /^Saved investigation / });
    if (newChat) {
      await page
        .getByRole("button", { name: "New session", exact: true })
        .click();
      await page
        .getByPlaceholder("Ask anything or run a command...")
        .fill("Keep my new draft");
    }
    failed = true;
    await page.evaluate(() => {
      for (const source of (
        window as unknown as { recoveryEventSources: EventSource[] }
      ).recoveryEventSources)
        if (source.url.includes("tables=control_sessions"))
          source.dispatchEvent(
            new MessageEvent("message", {
              data: JSON.stringify({ table: "control_sessions", op: "UPDATE" }),
            })
          );
    });
    await expect(sidebar.getByRole("alert")).toContainText(
      "Could not refresh chats"
    );
    await expect(row).toBeVisible();
    await (newChat
      ? expect(
          page.getByPlaceholder("Ask anything or run a command...")
        ).toHaveValue("Keep my new draft")
      : expect(page.getByText("Saved request", { exact: true })).toBeVisible());
    failed = false;
    await sidebar.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(sidebar.getByRole("alert")).toHaveCount(0);
    await expect(row).toBeVisible();
    await row.click();
    await expect(
      page.getByText("Saved request", { exact: true })
    ).toBeVisible();
  });
}

import { expect, test } from "@playwright/test";
import { scopedPath } from "./helpers/auth";
import { fulfillJson } from "./helpers/automation-control-plane-fixtures";
import {
  captureRecoveryEvents,
  invalidateRecoverySessions,
  mockRecoveryChrome,
  recoverySession,
} from "./helpers/control-recovery-fixtures";

for (const newChat of [false, true]) {
  test(`failed background history refresh keeps loaded chats usable in ${newChat ? "a new chat" : "the current chat"}`, async ({
    page,
  }) => {
    await mockRecoveryChrome(page);
    await captureRecoveryEvents(page);
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
    await invalidateRecoverySessions(page);
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

test("failed initial restore waits for explicit Retry after a history refresh", async ({
  page,
}) => {
  await mockRecoveryChrome(page);
  await captureRecoveryEvents(page);
  let failSelection = true;
  let refreshed = false;
  let selections = 0;
  await page.route("**/api/control/sessions**", (route) => {
    const id = new URL(route.request().url()).searchParams.get("id");
    if (id) selections++;
    return fulfillJson(
      route,
      id
        ? failSelection
          ? { error: "Could not load this chat. Try again." }
          : recoverySession
        : [
            {
              ...recoverySession,
              title: refreshed ? "Updated history" : recoverySession.title,
            },
          ],
      id && failSelection ? 503 : 200
    );
  });
  await page.goto(`${scopedPath("control")}?mission=${recoverySession.id}`);
  const banner = page
    .getByRole("alert")
    .filter({ hasText: "Could not load this chat" });
  await expect(banner).toBeVisible();
  const composer = page.getByPlaceholder("Ask anything or run a command...");
  await composer.fill("Do not discard this new draft");
  failSelection = false;
  refreshed = true;
  await invalidateRecoverySessions(page);
  await expect(
    page.getByRole("button", { name: /^Updated history / })
  ).toBeVisible();
  await expect(composer).toHaveValue("Do not discard this new draft");
  await banner.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("Saved request", { exact: true })).toBeVisible();
  expect(selections).toBe(3); // Initial restore, explicit Retry, current-chat hydration.
});

for (const mutation of ["archive", "delete"] as const) {
  test(`${mutation} retires the selected chat failure without a stale Retry`, async ({
    page,
  }) => {
    await mockRecoveryChrome(page);
    await captureRecoveryEvents(page);
    let failSelection = false;
    let removed = false;
    await page.route("**/api/control/sessions**", (route) => {
      const request = route.request();
      if (request.method() === "PUT") {
        removed = true;
        return fulfillJson(route, {
          session: { ...recoverySession, archived: true },
        });
      }
      if (request.method() === "DELETE") {
        removed = true;
        return fulfillJson(route, { ok: true });
      }
      const id = new URL(request.url()).searchParams.get("id");
      return fulfillJson(
        route,
        id
          ? failSelection
            ? { error: "Could not load this chat. Try again." }
            : recoverySession
          : removed
            ? []
            : [recoverySession],
        id && failSelection ? 503 : 200
      );
    });
    await page.goto(`${scopedPath("control")}?mission=${recoverySession.id}`);
    await expect(
      page.getByText("Saved request", { exact: true })
    ).toBeVisible();
    failSelection = true;
    await invalidateRecoverySessions(page);
    const banner = page
      .getByRole("alert")
      .filter({ hasText: "Could not load this chat" });
    await expect(banner).toBeVisible();
    if (mutation === "archive") {
      await page.getByRole("button", { name: "More options" }).click();
      await page
        .getByRole("menuitem", { name: "Archive", exact: true })
        .click();
    } else {
      await page
        .getByRole("button", { name: "Actions for Saved investigation" })
        .click();
      await page
        .getByRole("menuitem", { name: "Delete chat", exact: true })
        .click();
      await page
        .getByRole("alertdialog", { name: "Delete Saved investigation?" })
        .getByRole("button", { name: "Delete chat", exact: true })
        .click();
    }
    await expect(
      page.getByPlaceholder("Ask anything or run a command...")
    ).toBeVisible();
    await expect(banner).toHaveCount(0);
    expect(removed).toBe(true);
  });
}

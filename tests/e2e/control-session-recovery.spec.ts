import { expect, test } from "@playwright/test";
import { scopedPath } from "./helpers/auth";
import { fulfillJson } from "./helpers/automation-control-plane-fixtures";
import {
  mockRecoveryChrome,
  recoverySession,
} from "./helpers/control-recovery-fixtures";

test("failed session history shows an error and recovers through Retry", async ({
  page,
}) => {
  await mockRecoveryChrome(page);
  let failed = true;
  await page.route("**/api/control/sessions**", (route) => {
    const id = new URL(route.request().url()).searchParams.get("id");
    return fulfillJson(
      route,
      id
        ? recoverySession
        : failed
          ? { error: "Could not load chats. Try again." }
          : [recoverySession],
      !id && failed ? 500 : 200
    );
  });
  await page.goto(scopedPath("control"));
  const sidebar = page.getByRole("complementary", { name: "Sessions" });
  await expect(sidebar.getByRole("alert")).toContainText(
    "Could not load chats"
  );
  await expect(page.getByText("No sessions yet", { exact: false })).toHaveCount(
    0
  );
  failed = false;
  await sidebar.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByText("Saved request", { exact: true })).toBeVisible();
});

for (const explicitNew of [false, true]) {
  test(`pending history ${explicitNew ? "allows an explicit new chat" : "keeps the new-chat form hidden"}`, async ({
    page,
  }) => {
    await mockRecoveryChrome(page);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/control/sessions**", async (route) => {
      const id = new URL(route.request().url()).searchParams.get("id");
      if (!id) await pending;
      return fulfillJson(route, id ? recoverySession : [recoverySession]);
    });
    await page.goto(scopedPath("control"));
    await expect(
      page.getByRole("status", { name: "Loading conversation" })
    ).toBeVisible();
    const composer = page.getByPlaceholder("Ask anything or run a command...");
    await expect(composer).toHaveCount(0);
    if (explicitNew) {
      await page
        .getByRole("button", { name: "New session", exact: true })
        .click();
      await expect(composer).toBeVisible();
    }
    release();
    await (explicitNew
      ? expect(composer).toBeVisible()
      : expect(page.getByText("Saved request", { exact: true })).toBeVisible());
  });
}

test("a missing session selection reports the failure while keeping the current chat", async ({
  page,
}) => {
  await mockRecoveryChrome(page);
  const gone = { ...recoverySession, id: "gone", title: "Deleted elsewhere" };
  await page.route("**/api/control/sessions**", (route) => {
    const id = new URL(route.request().url()).searchParams.get("id");
    return fulfillJson(
      route,
      id === "gone"
        ? { error: "Not found" }
        : id
          ? recoverySession
          : [recoverySession, gone],
      id === "gone" ? 404 : 200
    );
  });
  await page.goto(`${scopedPath("control")}?mission=${recoverySession.id}`);
  await expect(page.getByText("Saved request", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^Deleted elsewhere / }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "That session no longer exists" })
  ).toContainText("That session no longer exists");
  await expect(page.getByText("Saved request", { exact: true })).toBeVisible();
});

test("a failed restore is retried on the next history refresh without reloading", async ({
  page,
}) => {
  await mockRecoveryChrome(page);
  let attempts = 0;
  await page.route("**/api/control/sessions**", (route) => {
    const id = new URL(route.request().url()).searchParams.get("id");
    if (!id) return fulfillJson(route, [recoverySession]);
    attempts++;
    return fulfillJson(
      route,
      attempts === 1
        ? { error: "Could not load this chat. Try again." }
        : recoverySession,
      attempts === 1 ? 503 : 200
    );
  });
  await page.goto(scopedPath("control"));
  const error = page
    .getByRole("alert")
    .filter({ hasText: "Could not load this chat" });
  await expect(error).toBeVisible();
  await error.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("Saved request", { exact: true })).toBeVisible();
  expect(attempts).toBeGreaterThan(1);
});

for (const hasOtherChats of [false, true]) {
  test(`archiving the selected chat opens a fresh composer ${hasOtherChats ? "with another chat remaining" : "when history becomes empty"}`, async ({
    page,
  }) => {
    await mockRecoveryChrome(page);
    let archived = false;
    const other = {
      ...recoverySession,
      id: "other-chat",
      title: "Another chat",
      messages: [],
    };
    await page.route("**/api/control/sessions**", (route) => {
      if (route.request().method() === "PUT") {
        archived = true;
        return fulfillJson(route, {
          session: { ...recoverySession, archived: true },
        });
      }
      const id = new URL(route.request().url()).searchParams.get("id");
      return fulfillJson(
        route,
        id
          ? recoverySession
          : [
              ...(archived ? [] : [recoverySession]),
              ...(hasOtherChats ? [other] : []),
            ]
      );
    });
    await page.goto(`${scopedPath("control")}?mission=${recoverySession.id}`);
    await expect(
      page.getByText("Saved request", { exact: true })
    ).toBeVisible();
    await page.getByRole("button", { name: "More options" }).click();
    await page.getByRole("menuitem", { name: "Archive", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Start mission" })
    ).toBeVisible();
    await expect(
      page.getByRole("status", { name: "Loading conversation" })
    ).toHaveCount(0);
    await expect(page.getByText("Saved request", { exact: true })).toHaveCount(
      0
    );
  });
}

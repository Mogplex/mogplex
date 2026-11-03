import { expect, test, type Page } from "@playwright/test";
import { setupControlSidebar } from "./helpers/control-sidebar-fixture";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function archiveSelected(page: Page) {
  await page.getByRole("button", { name: "More options" }).click();
  await page.getByRole("menuitem", { name: "Archive", exact: true }).click();
}

for (const height of [390, 320]) {
  test(`landscape notifications leave the real composer and Stop usable at ${height}px`, async ({
    page,
  }, testInfo) => {
    const held = deferred();
    const { sidebar } = await setupControlSidebar(page);
    await page.route("**/api/control/chat", async (route) => {
      await held.promise;
      await route
        .fulfill({
          status: 200,
          headers: {
            "content-type": "text/event-stream",
            "x-vercel-ai-ui-message-stream": "v1",
          },
          body: 'data: {"type":"start"}\n\ndata: {"type":"finish"}\n\ndata: [DONE]\n\n',
        })
        .catch(() => undefined);
    });
    try {
      await sidebar
        .getByRole("button", { name: "Actions for acme/other", exact: true })
        .click();
      await page
        .getByRole("menuitem", { name: "Archive chats", exact: true })
        .click();
      const notification = page
        .locator('[data-variant="info"]')
        .filter({ hasText: "1 chat archived" });
      await expect(notification).toBeVisible();
      await page.setViewportSize({ width: 844, height });
      const composer = page.locator("#control-composer");
      await composer.fill("Keep the real controls available.");
      await composer.press("Enter");
      const stop = page.getByRole("button", { name: "Stop", exact: true });
      await expect(stop).toBeVisible();
      await expect(
        page.locator('[data-slot="toast-viewport"]')
      ).toHaveAttribute("data-compact", "");
      await page.screenshot({
        path: testInfo.outputPath(`real-controls-${height}.png`),
      });
      const viewport = await page
        .locator('[data-slot="toast-viewport"]')
        .boundingBox();
      const close = await notification
        .getByRole("button", { name: "Dismiss notification" })
        .boundingBox();
      const input = await composer.boundingBox();
      const stopBox = await stop.boundingBox();
      const context = await page
        .getByLabel("Context usage", { exact: true })
        .boundingBox();
      expect(context!.x + context!.width).toBeLessThanOrEqual(stopBox!.x);
      expect(context!.y + context!.height).toBeLessThanOrEqual(height);
      expect(close!.height).toBeGreaterThanOrEqual(44);
      expect(close!.y).toBeGreaterThanOrEqual(viewport!.y);
      expect(close!.y + close!.height).toBeLessThanOrEqual(
        viewport!.y + viewport!.height
      );
      expect(viewport!.y + viewport!.height).toBeLessThan(input!.y);
      expect(
        await stop.evaluate((button) => {
          const box = button.getBoundingClientRect();
          return button.contains(
            document.elementFromPoint(
              box.x + box.width / 2,
              box.y + box.height / 2
            )
          );
        })
      ).toBe(true);
      await stop.click();
    } finally {
      held.resolve();
    }
  });
}

test("a failed archive releases the composer and preserves its draft", async ({
  page,
}) => {
  const requested = deferred();
  const response = deferred();
  const { failArchives } = await setupControlSidebar(page, {
    beforeUpdate: async () => {
      requested.resolve();
      await response.promise;
    },
  });
  failArchives();
  try {
    const composer = page.getByPlaceholder(
      "Ask for follow-up changes or attach images"
    );
    await composer.fill("Keep this draft after failure");
    await archiveSelected(page);
    await requested.promise;
    await expect(composer).toBeDisabled();
    response.resolve();
    await expect(
      page.getByText("Could not archive 1 chat. Try again.", { exact: true })
    ).toBeVisible();
    await expect(composer).toBeEnabled();
    await expect(composer).toHaveValue("Keep this draft after failure");
    await page.route("**/api/control/chat", (route) =>
      route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "x-vercel-ai-ui-message-stream": "v1",
        },
        body: 'data: {"type":"start"}\n\ndata: {"type":"finish"}\n\ndata: [DONE]\n\n',
      })
    );
    const sent = page.waitForRequest((request) =>
      request.url().endsWith("/api/control/chat")
    );
    await composer.press("Enter");
    expect((await sent).postData()).toContain("Keep this draft after failure");
  } finally {
    response.resolve();
  }
});

test("an archive reserves its chat until the delayed server response arrives", async ({
  page,
}) => {
  const archived = deferred();
  const response = deferred();
  const { sidebar } = await setupControlSidebar(page, {
    updated: async (session) => {
      if (session.id === "chat-0" && session.archived) {
        archived.resolve();
        await response.promise;
      }
    },
  });
  const submitted: string[] = [];
  await page.route("**/api/control/chat", async (route) => {
    submitted.push(route.request().postData() ?? "");
    await route.fulfill({ status: 500, body: "Unexpected submission" });
  });
  try {
    const composer = page.getByPlaceholder(
      "Ask for follow-up changes or attach images"
    );
    await composer.fill("A reply must not start during archive");
    await archiveSelected(page);
    await archived.promise;
    await expect(
      page.getByText("Archive in progress", { exact: true })
    ).toBeVisible();
    await expect(composer).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Send", exact: true })
    ).toBeDisabled();
    await composer.dispatchEvent("keydown", {
      key: "Enter",
      code: "Enter",
      bubbles: true,
    });
    expect(submitted).toEqual([]);
    response.resolve();
    await expect(
      page.getByText("1 chat archived", { exact: true })
    ).toBeVisible();
    expect(submitted).toEqual([]);
    await sidebar.getByRole("button", { name: /^Fix 6 / }).click();
    await expect(
      page.getByPlaceholder("Ask for follow-up changes or attach images")
    ).toBeEnabled();
  } finally {
    response.resolve();
  }
});

for (const explicitNew of [false, true])
  for (const mutation of ["archive", "restore"] as const) {
    test(`${mutation} completion preserves an unrelated pending selection${explicitNew ? " and a later explicit new chat" : ""}`, async ({
      page,
    }) => {
      const selecting = deferred();
      const response = deferred();
      let holdSelection = false;
      const { sidebar } = await setupControlSidebar(page, {
        selected: async (session) => {
          if (holdSelection && session.id === "other") {
            selecting.resolve();
            await response.promise;
          }
        },
      });
      try {
        if (mutation === "restore") {
          await archiveSelected(page);
          await expect(
            page.getByText("1 chat archived", { exact: true })
          ).toBeVisible();
        }
        holdSelection = true;
        await sidebar
          .getByRole("button", { name: /^Another project / })
          .click();
        await selecting.promise;
        if (mutation === "archive") {
          await archiveSelected(page);
          await expect(
            page.getByText("1 chat archived", { exact: true })
          ).toBeVisible();
        } else {
          await sidebar
            .getByRole("button", { name: "Archived chats", exact: true })
            .click();
          const restore = sidebar.getByRole("button", {
            name: "Restore Zebra investigation",
          });
          await restore.click();
          await expect(restore).toHaveCount(0);
        }
        if (explicitNew && mutation === "restore")
          await sidebar
            .getByRole("button", { name: "Back to chats", exact: true })
            .click();
        if (explicitNew)
          await sidebar
            .getByRole("button", { name: "New session", exact: true })
            .click();
        response.resolve();
        await expect(page).toHaveURL(/mission=other/);
        await (explicitNew
          ? expect(
              page.getByRole("button", { name: "Start mission" })
            ).toBeVisible()
          : expect(
              page.getByPlaceholder(
                "Ask for follow-up changes or attach images"
              )
            ).toBeEnabled());
      } finally {
        response.resolve();
      }
    });
  }

test("Undo waits for another archive instead of discarding the restore", async ({
  page,
}) => {
  const archiving = deferred();
  const response = deferred();
  const { sidebar } = await setupControlSidebar(page, {
    updated: async (session) => {
      if (session.id === "chat-6" && session.archived) {
        archiving.resolve();
        await response.promise;
      }
    },
  });
  try {
    await archiveSelected(page);
    await expect(
      page.getByText("1 chat archived", { exact: true })
    ).toBeVisible();
    await sidebar.getByRole("button", { name: /^Fix 6 / }).click();
    // A visible Undo must not cover the menu needed for the next action.
    expect(
      await page
        .getByRole("button", { name: "More options" })
        .evaluate((button) => {
          const bounds = button.getBoundingClientRect();
          return button.contains(
            document.elementFromPoint(
              bounds.x + bounds.width / 2,
              bounds.y + bounds.height / 2
            )
          );
        })
    ).toBe(true);
    await archiveSelected(page);
    await archiving.promise;
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    response.resolve();
    await expect(
      sidebar.getByRole("button", { name: /^Zebra investigation/ })
    ).toBeVisible();
    await expect(sidebar.getByRole("button", { name: /^Fix 6 / })).toHaveCount(
      0
    );
  } finally {
    response.resolve();
  }
});

test("Undo preserves older archives while the archived list is loading", async ({
  page,
}) => {
  const requested = deferred();
  const response = deferred();
  let archiveLoads = 0;
  const { sidebar, sessions } = await setupControlSidebar(page, {
    listed: async (archived) => {
      if (archived && archiveLoads++ === 0) {
        requested.resolve();
        await response.promise;
      }
    },
  });
  sessions.push({
    ...sessions[0],
    id: "older",
    title: "Older archived chat",
    archived: true,
  });
  try {
    await archiveSelected(page);
    await expect(
      page.getByText("1 chat archived", { exact: true })
    ).toBeVisible();
    await sidebar
      .getByRole("button", { name: "Archived chats", exact: true })
      .click();
    await requested.promise;
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    const older = sidebar.getByRole("button", {
      name: "Restore Older archived chat",
    });
    await expect(older).toBeVisible();
    await expect(
      sidebar.getByRole("button", { name: "Restore Zebra investigation" })
    ).toHaveCount(0);
    const initialLoad = page.waitForResponse((result) =>
      result.url().includes("archived=true")
    );
    response.resolve();
    await initialLoad;
    await expect(older).toBeVisible();
  } finally {
    response.resolve();
  }
});

test("a late selection response cannot reopen a chat that was archived", async ({
  page,
}) => {
  const selecting = deferred();
  const response = deferred();
  const { sidebar } = await setupControlSidebar(page, {
    selected: async (session) => {
      if (session.id === "chat-6") {
        selecting.resolve();
        await response.promise;
      }
    },
  });
  try {
    await sidebar.getByRole("button", { name: /^Fix 6 / }).click();
    await selecting.promise;
    await sidebar
      .getByRole("button", { name: "Actions for acme/widgets" })
      .click();
    await page
      .getByRole("menuitem", { name: "Archive chats", exact: true })
      .click();
    await expect(
      page.getByText("7 chats archived", { exact: true })
    ).toBeVisible();
    const completed = page.waitForResponse((response) =>
      response.url().includes("sessions?id=chat-6")
    );
    response.resolve();
    await completed;
    await expect(page).toHaveURL(/\/control$/);
    await expect(
      sidebar.getByRole("button", { name: "Actions for acme/widgets" })
    ).toHaveCount(0);
  } finally {
    response.resolve();
  }
});

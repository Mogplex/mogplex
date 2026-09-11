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

for (const mutation of ["archive", "restore"] as const) {
  test(`${mutation} completion preserves an unrelated pending selection`, async ({
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
      await sidebar.getByRole("button", { name: /^Another project / }).click();
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
      response.resolve();
      await expect(page).toHaveURL(/mission=other/);
      await expect(
        page.getByPlaceholder("Ask for follow-up changes or attach images")
      ).toBeEnabled();
    } finally {
      response.resolve();
    }
  });
}

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

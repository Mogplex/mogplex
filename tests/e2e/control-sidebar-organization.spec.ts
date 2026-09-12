import { expect, test } from "@playwright/test";
import { setupControlSidebar as setup } from "./helpers/control-sidebar-fixture";

test("sidebar organization and sorting persist across reload and preserve selection", async ({
  page,
}) => {
  const { sidebar } = await setup(page);
  await sidebar.getByRole("button", { name: "Sidebar options" }).click();
  await page.getByRole("menuitem", { name: "Organize sidebar" }).hover();
  await expect(
    page.getByRole("menuitemradio", { name: "By project" })
  ).toBeChecked();
  await page.getByRole("menuitemradio", { name: "In one list" }).click();
  await expect(
    sidebar.getByRole("button", { name: "Actions for acme/widgets" })
  ).toHaveCount(0);
  await expect(
    sidebar.getByRole("button", { name: /^Zebra investigation/ })
  ).toBeVisible();
  await expect(page).toHaveURL(/mission=chat-0/);
  await page.screenshot({ path: "/tmp/mogplex-sidebar-one-list.png" });
  await page.reload();
  await expect(
    sidebar.getByRole("button", { name: /^Zebra investigation/ })
  ).toBeVisible();
  await expect(
    sidebar.getByRole("button", { name: "Actions for acme/widgets" })
  ).toHaveCount(0);
  await sidebar.getByRole("button", { name: "Sidebar options" }).click();
  await page.getByRole("menuitem", { name: "Sort chats by" }).hover();
  await page.getByRole("menuitemradio", { name: "Name" }).click();
  await expect(
    sidebar.locator("nav button:not([aria-label])").nth(1)
  ).toContainText("Fix 1");
  await expect(sidebar.locator("nav button[aria-current]")).toHaveText(
    /Zebra investigation/
  );
  await page.reload();
  await expect(sidebar.locator("nav button").first()).toContainText(
    "Another project"
  );
  await sidebar.getByRole("button", { name: "Sidebar options" }).click();
  await page.getByRole("menuitem", { name: "Organize sidebar" }).hover();
  await expect(
    page.getByRole("menuitemradio", { name: "In one list" })
  ).toBeChecked();
  await page.screenshot({
    path: "/tmp/mogplex-sidebar-organize-menu.png",
    animations: "disabled",
  });
  await page.getByRole("menuitemradio", { name: "By project" }).click();
  await expect(
    sidebar.getByRole("button", { name: "Actions for acme/widgets" })
  ).toBeVisible();
  await page.screenshot({ path: "/tmp/mogplex-sidebar-organize.png" });
});

test("partial archive reports failures and Undo restores only the chats that changed", async ({
  page,
}) => {
  const { sidebar, sessions, failArchiveId } = await setup(page);
  failArchiveId("chat-3");
  await sidebar
    .getByRole("button", { name: "Actions for acme/widgets" })
    .click();
  await page
    .getByRole("menuitem", { name: "Archive chats", exact: true })
    .click();
  await expect(
    page.getByText("6 chats archived", { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText("1 could not be archived. Try again.", { exact: true })
  ).toBeVisible();
  await expect(sidebar.getByRole("button", { name: /^Fix 3 / })).toBeVisible();
  expect(sessions.filter((session) => session.archived)).toHaveLength(6);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(
    sidebar.getByRole("button", { name: /acme\/widgets.*7/ })
  ).toBeVisible();
  expect(sessions.filter((session) => session.archived)).toHaveLength(0);
});

test("group archive includes hidden chats, supports Undo, and restores after reload", async ({
  page,
}) => {
  const { sidebar, sessions } = await setup(page);
  const archive = async () => {
    await sidebar
      .getByRole("button", { name: "Actions for acme/widgets" })
      .click();
    await page
      .getByRole("menuitem", { name: "Archive chats", exact: true })
      .click();
    await expect(
      page.getByText("7 chats archived", { exact: true })
    ).toBeVisible();
  };
  await archive();
  await expect(
    sidebar.getByRole("button", { name: "Actions for acme/widgets" })
  ).toHaveCount(0);
  await expect(
    sidebar.getByRole("button", { name: "Actions for acme/other" })
  ).toBeVisible();
  expect(sessions.filter((s) => s.archived)).toHaveLength(7);
  await expect(page).toHaveURL(/\/control$/);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(
    sidebar.getByRole("button", { name: /acme\/widgets.*7/ })
  ).toBeVisible();
  expect(sessions.filter((s) => s.archived)).toHaveLength(0);
  await archive();
  await expect(
    sidebar.getByRole("button", { name: "Actions for acme/widgets" })
  ).toHaveCount(0);
  await page.reload();
  await sidebar
    .getByRole("button", { name: "Archived chats", exact: true })
    .click();
  await expect(
    sidebar.getByRole("button", { name: "Restore Zebra investigation" })
  ).toBeVisible();
  await expect(sidebar.getByRole("button", { name: /^Restore / })).toHaveCount(
    7
  );
  await page.screenshot({ path: "/tmp/mogplex-sidebar-archive.png" });
  await sidebar
    .getByRole("button", { name: "Restore Zebra investigation" })
    .click();
  await expect(
    sidebar.getByRole("button", { name: "Restore Zebra investigation" })
  ).toHaveCount(0);
  await sidebar.getByRole("button", { name: "Back to chats" }).click();
  await expect(
    sidebar.getByRole("button", { name: /^Zebra investigation/ })
  ).toBeVisible();
});

test("archive failure leaves chats visible and reports the error", async ({
  page,
}) => {
  const { sidebar, failArchives } = await setup(page);
  failArchives();
  await sidebar
    .getByRole("button", { name: "Actions for acme/widgets" })
    .click();
  await page
    .getByRole("menuitem", { name: "Archive chats", exact: true })
    .click();
  await expect(
    page.getByText("Could not archive 7 chats. Try again.", { exact: true })
  ).toBeVisible();
  await expect(
    sidebar.getByRole("button", { name: /acme\/widgets.*7/ })
  ).toBeVisible();
  await expect(page).toHaveURL(/mission=chat-0/);
});

test("group archive keeps a submitted chat running while it archives the other chats", async ({
  page,
}) => {
  const { sidebar, sessions } = await setup(page);
  let finishResponse!: () => void;
  const responseReady = new Promise<void>((resolve) => {
    finishResponse = resolve;
  });
  await page.route("**/api/control/chat", async (route) => {
    await responseReady;
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "x-vercel-ai-ui-message-stream": "v1",
      },
      body: 'data: {"type":"start"}\n\ndata: {"type":"finish"}\n\ndata: [DONE]\n\n',
    });
  });
  try {
    await page
      .getByPlaceholder("Ask for follow-up changes or attach images")
      .fill("Keep working on this chat");
    await page.keyboard.press("Enter");
    await sidebar.getByRole("button", { name: "Show more" }).click();
    await expect(
      sidebar.getByRole("button", { name: /^Working Zebra investigation/ })
    ).toBeVisible();
    await sidebar
      .getByRole("button", { name: "Actions for acme/widgets" })
      .click();
    await page
      .getByRole("menuitem", { name: "Archive chats", exact: true })
      .click();
    await expect(
      sidebar.getByRole("button", { name: /acme\/widgets.*1/ })
    ).toBeVisible();
    await expect(
      sidebar.getByRole("button", { name: /^Working Zebra investigation/ })
    ).toBeVisible();
    expect(sessions.filter((session) => session.archived)).toHaveLength(6);
    expect(sessions.find((session) => session.id === "chat-0")?.archived).toBe(
      false
    );
    await expect(page).toHaveURL(/mission=chat-0/);
  } finally {
    finishResponse();
  }
});

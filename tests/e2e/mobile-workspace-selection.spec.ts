import { expect, test, type Page } from "@playwright/test";
import type { Session } from "@/hooks/session-types";
import type { PaneNode, TreeNode } from "@/hooks/split-panes-types";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import { mockActivationFlow } from "./helpers/activation-fixtures";

const pane = (id: string, type: PaneNode["type"]): PaneNode => ({
  id,
  type,
  name: id,
  lines: [],
  status: "idle",
});
const tree: TreeNode = {
  id: "root",
  dir: "horizontal",
  sizes: [50, 50],
  children: [
    pane("chat-one", "agent"),
    {
      id: "nested",
      dir: "vertical",
      sizes: [50, 50],
      children: [pane("files-one", "files"), pane("files-two", "files")],
    },
  ],
};

async function installWorkspace(page: Page) {
  await enableScopedE2EAuth(page);
  await mockActivationFlow(page);
  const sessions: Session[] = [
    {
      id: "workspace-one",
      index: 0,
      name: "First workspace",
      color: "green",
      paneTree: tree,
      activeId: "files-two",
    },
    {
      id: "workspace-two",
      index: 1,
      name: "Second workspace",
      color: "blue",
      paneTree: tree,
      activeId: "chat-one",
    },
  ];
  await page.addInitScript(
    (state) => {
      if (!localStorage.getItem("mogplex-sessions"))
        localStorage.setItem(
          "mogplex-sessions",
          JSON.stringify({ state, version: 3 })
        );
    },
    { sessions, activeSessionId: "workspace-one" }
  );
}

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});

test("mobile restores the exact selected pane and follows workspace selection", async ({
  page,
}) => {
  await installWorkspace(page);
  await page.goto(scopedPath("projects/workspace"));
  await expect(page.getByTestId("pane-files-two")).toBeVisible();
  await expect(page.getByTestId("pane-files-one")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Files", exact: true })
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("session-tab-1").click();
  await expect(page.getByTestId("pane-chat-one")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Chat", exact: true })
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("session-tab-0").click();
  await expect(page.getByTestId("pane-files-two")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.reload();
  await expect(page.getByTestId("pane-files-two")).toBeVisible();
});

test("mobile tab selection updates the shared selected pane", async ({
  page,
}) => {
  await installWorkspace(page);
  await page.goto(scopedPath("projects/workspace"));
  await expect(page.getByTestId("pane-files-two")).toBeVisible();
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  await expect(page.getByTestId("pane-chat-one")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.reload();
  await expect(page.getByTestId("pane-chat-one")).toBeVisible();
  await page.getByRole("button", { name: "Files", exact: true }).click();
  await expect(page.getByTestId("pane-files-one")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Preview", exact: true })
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Terminal", exact: true })
  ).toBeDisabled();
});

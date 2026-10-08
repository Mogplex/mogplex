import { expect, test } from "@playwright/test";
import { selectAppOption } from "./helpers/app-select";
import {
  stubFlowsPage,
  primaryModifier,
} from "./helpers/flows-pane-keyboard-fixtures";
import type { FlowNode } from "../../lib/types";

const installations = [
  {
    id: "inst-1",
    installation_id: 101,
    account_login: "webrenew",
    account_type: "Organization" as const,
    repositories: [{ id: "repo-1", full_name: "webrenew/blackbox" }],
  },
  {
    id: "inst-2",
    installation_id: 202,
    account_login: "alex",
    account_type: "User" as const,
    repositories: [{ id: "repo-2", full_name: "alex/priority-project" }],
  },
  {
    id: "inst-3",
    installation_id: 303,
    account_login: "Mogplex",
    account_type: "Organization" as const,
    repositories: [{ id: "repo-3", full_name: "Mogplex/mogplex" }],
  },
];

test("a multi-account PR trigger shows every account and keeps them across edits", async ({
  page,
}) => {
  // flows.installation_id is 101, but the trigger routes for 101 and 202. The
  // editor used to show only "webrenew" and rewrote the filter to [101] on any
  // edit, silently dropping the other account.
  const { getFlow } = await stubFlowsPage(page, {
    installations,
    startFilter: { scope: "all", installationIds: [101, 202] },
  });
  const savedFilter = () =>
    (getFlow().draft_graph.nodes as FlowNode[]).find(
      (node) => node.type === "start"
    )?.data.filter;

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");

  const filterBar = page.getByTestId("flow-browser-filters");
  await selectAppOption(page.getByTestId("flow-browser-account"), "202");
  await expect(filterBar).toContainText("1 of 1 workflows");
  await selectAppOption(page.getByTestId("flow-browser-account"), "303");
  await expect(filterBar).toContainText("0 of 1 workflows");
  await selectAppOption(page.getByTestId("flow-browser-account"), "all");

  const startNode = page
    .locator(".react-flow__node")
    .filter({ hasText: "PR opened" });
  await expect(startNode).toContainText("webrenew, alex · All repositories");
  await startNode.click();

  const account = page.getByTestId("flow-trigger-account");
  await expect(account).toHaveAttribute("data-value", "101,202");
  await expect(account).toContainText("webrenew, alex");

  await selectAppOption(
    page.getByTestId("flow-trigger-author-filter"),
    "exclude_dependabot"
  );
  await page.keyboard.press(`${primaryModifier}+S`);
  await expect.poll(savedFilter).toEqual({
    scope: "all",
    installationIds: [101, 202],
    authorFilter: "exclude_dependabot",
  });

  await account.click();
  await page.getByTestId("flow-trigger-account-option-all").click();
  await account.click();
  await expect(account).toHaveAttribute("data-value", "all");
  await expect(startNode).toContainText("All accounts · All repositories");
  await page.keyboard.press(`${primaryModifier}+S`);
  await expect.poll(savedFilter).toEqual({
    scope: "all",
    authorFilter: "exclude_dependabot",
  });
});

test("an org-scoped PR trigger keeps its account-type scope across edits", async ({
  page,
}) => {
  // API-authored filters can narrow by account type. The editor must show it
  // and keep it; edits used to rewrite scope to "all", widening the trigger.
  const { getFlow } = await stubFlowsPage(page, {
    installations,
    startFilter: { scope: "org" },
  });
  const savedFilter = () =>
    (getFlow().draft_graph.nodes as FlowNode[]).find(
      (node) => node.type === "start"
    )?.data.filter;

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");

  const filterBar = page.getByTestId("flow-browser-filters");
  await selectAppOption(page.getByTestId("flow-browser-account"), "202");
  await expect(filterBar).toContainText("0 of 1 workflows");
  await selectAppOption(page.getByTestId("flow-browser-account"), "303");
  await expect(filterBar).toContainText("1 of 1 workflows");

  const startNode = page
    .locator(".react-flow__node")
    .filter({ hasText: "PR opened" });
  await expect(startNode).toContainText("All organizations");
  await startNode.click();
  const account = page.getByTestId("flow-trigger-account");
  await expect(account).toHaveAttribute("data-value", "all-org");

  await selectAppOption(
    page.getByTestId("flow-trigger-author-filter"),
    "humans_only"
  );
  await page.keyboard.press(`${primaryModifier}+S`);
  await expect.poll(savedFilter).toEqual({
    scope: "org",
    authorFilter: "humans_only",
  });
});

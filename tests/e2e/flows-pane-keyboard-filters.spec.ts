import { expect, test } from "@playwright/test";
import { selectAppOption } from "./helpers/app-select";
import {
  stubFlowsPage,
  fulfillJson,
  primaryModifier,
} from "./helpers/flows-pane-keyboard-fixtures";
import type { FlowNode } from "../../lib/types";

test("workflow viewing filters stay outside the canvas and trigger scope binds account plus repository", async ({
  page,
}) => {
  let publishCount = 0;
  const { getFlow } = await stubFlowsPage(page, {
    flowStatus: "inactive",
    onFlowPublish: () => {
      publishCount += 1;
    },
    installations: [
      {
        id: "inst-1",
        installation_id: 101,
        account_login: "webrenew",
        account_type: "Organization",
        repositories: [
          { id: "repo-1", full_name: "webrenew/blackbox" },
          { id: "repo-2", full_name: "webrenew/mogplex" },
        ],
      },
      {
        id: "inst-2",
        installation_id: 202,
        account_login: "alex",
        account_type: "User",
        repositories: [{ id: "repo-3", full_name: "alex/priority-project" }],
      },
    ],
  });
  const broadFlow = getFlow();
  const scopedFlow = (
    id: string,
    name: string,
    installationId: number,
    repo: string
  ) => ({
    ...structuredClone(broadFlow),
    id,
    name,
    installation_id: installationId,
    draft_graph: {
      ...structuredClone(broadFlow.draft_graph),
      nodes: broadFlow.draft_graph.nodes.map((node) =>
        node.type === "start"
          ? {
              ...structuredClone(node),
              data: {
                ...structuredClone(node.data),
                filter: {
                  scope: "all",
                  installationIds: [installationId],
                  repos: [repo],
                },
              },
            }
          : structuredClone(node)
      ),
    },
  });
  await page.unroute("**/api/flows");
  await page.route("**/api/flows", (route) =>
    fulfillJson(route, [
      broadFlow,
      scopedFlow(
        "flow-blackbox",
        "Blackbox strict checks",
        101,
        "webrenew/blackbox"
      ),
      scopedFlow(
        "flow-mogplex",
        "Mogplex strict checks",
        101,
        "webrenew/mogplex"
      ),
      scopedFlow(
        "flow-personal",
        "Personal checks",
        202,
        "alex/priority-project"
      ),
    ])
  );

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");

  const filterBar = page.getByTestId("flow-browser-filters");
  const canvas = page.locator(".react-flow");
  await expect(filterBar).toBeVisible();
  await expect(
    page.getByLabel("Filter workflows by GitHub account")
  ).toHaveAttribute("data-value", "all");
  await expect(page.getByLabel("New workflow installation")).toHaveCount(0);
  const filterBox = await filterBar.boundingBox();
  const canvasBox = await canvas.boundingBox();
  expect(filterBox).not.toBeNull();
  expect(canvasBox).not.toBeNull();
  expect(filterBox!.y + filterBox!.height).toBeLessThanOrEqual(canvasBox!.y);

  await selectAppOption(page.getByTestId("flow-browser-account"), "101");
  await expect(filterBar).toContainText("3 of 4 workflows");
  const repositoryFilter = page.getByTestId("flow-browser-repository");
  await repositoryFilter.click();
  await page
    .getByTestId("flow-browser-repository-option-webrenew/blackbox")
    .click();
  await repositoryFilter.click();
  await expect(filterBar).toContainText("2 of 4 workflows");
  await repositoryFilter.click();
  await page
    .getByTestId("flow-browser-repository-option-webrenew/mogplex")
    .click();
  await repositoryFilter.click();
  await expect(repositoryFilter).toContainText("2 repositories");
  await expect(filterBar).toContainText("3 of 4 workflows");
  await page.getByLabel("Select workflow").click();
  await expect(page.getByRole("option")).toHaveCount(3);
  await page.keyboard.press("Escape");

  const startNode = page
    .locator(".react-flow__node")
    .filter({ hasText: "PR opened" });
  await startNode.click();

  const account = page.getByTestId("flow-trigger-account");
  await expect(account).toHaveAttribute("data-value", "101");
  const repositoryScope = page.getByTestId("flow-trigger-repository-scope");
  await expect(repositoryScope).toContainText("All repositories");
  await repositoryScope.click();
  await page
    .getByTestId("flow-trigger-repository-option-webrenew/blackbox")
    .click();
  await repositoryScope.click();
  await expect(startNode).toContainText("webrenew · webrenew/blackbox");

  await selectAppOption(account, "202");
  await expect(repositoryScope).toContainText("All repositories");
  await repositoryScope.click();
  await page
    .getByTestId("flow-trigger-repository-option-alex/priority-project")
    .click();
  await repositoryScope.click();
  await expect(startNode).toContainText("alex · alex/priority-project");
  await page.keyboard.press(`${primaryModifier}+S`);

  await expect.poll(() => getFlow().installation_id).toBe(101);
  await expect
    .poll(() => {
      const start = (getFlow().draft_graph.nodes as FlowNode[]).find(
        (node) => node.type === "start"
      );
      return start?.data.filter;
    })
    .toMatchObject({
      scope: "all",
      installationIds: [202],
      repos: ["alex/priority-project"],
    });
  const publishButton = page.getByTestId("flow-publish-button");
  await expect(publishButton).toHaveText("Publish & activate");
  await publishButton.click();
  await expect.poll(() => publishCount).toBe(1);
  await expect.poll(() => getFlow().installation_id).toBe(202);
});

import { expect, test } from "@playwright/test";
import {
  flowPayload,
  fulfillJson,
  setupWorkflowsPage,
  openAgentInspector,
} from "./helpers/flows-inspector-layout-fixtures";
import type { FlowGraph } from "@/lib/types";

test("scheduled Task instructions and role survive save and reload", async ({
  page,
}, testInfo) => {
  await setupWorkflowsPage(page);
  let graph = structuredClone(flowPayload.draft_graph) as FlowGraph;
  const agent = graph.nodes.find((node) => node.type === "agent")!;
  Object.assign(agent.data, {
    autofix: true,
    autofixSandbox: true,
    autoMerge: true,
    autoRevert: true,
  });
  const start = graph.nodes.find((node) => node.type === "start")!;
  start.data = {
    label: "Daily",
    event: "schedule",
    scheduleCron: "10 7 * * *",
    scheduleTimezone: "UTC",
    filter: {
      scope: "org",
      installationIds: [101],
      repos: ["webrenew/blackbox"],
    },
  };
  const payload = () => ({ ...flowPayload, draft_graph: graph });
  await page.route("**/api/flows", (route) => fulfillJson(route, [payload()]));
  await page.route("**/api/flows/flow-1", async (route) => {
    if (route.request().method() === "PUT")
      graph = route.request().postDataJSON().draft_graph;
    await fulfillJson(route, payload());
  });
  await openAgentInspector(page);
  await page.getByRole("combobox", { name: "Agent task" }).click();
  await page.getByRole("option", { name: "Task", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: /^Auto-fix issues/ })
  ).toHaveCount(0);
  const approval = page.getByRole("checkbox", {
    name: /^Require approval for tool calls/,
  });
  await expect(approval).toBeVisible();
  await approval.check();
  const instructions =
    "Check open PRs, run repository checks, and open a PR only for missing changes.";
  await page.getByLabel("System prompt override").fill(instructions);
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/flows/flow-1") &&
      response.request().method() === "PUT"
  );
  await page.keyboard.press("ControlOrMeta+s");
  await saved;
  expect(graph.nodes.find((node) => node.type === "agent")?.data.role).toBe(
    "task"
  );
  expect(graph.nodes.find((node) => node.type === "agent")?.data).toMatchObject(
    {
      autofix: false,
      autofixSandbox: false,
      autoMerge: false,
      autoRevert: false,
      requireApproval: true,
    }
  );
  await page.reload();
  await page.locator('.react-flow__node[data-id="agent-1"]').click();
  await expect(page.getByRole("combobox", { name: "Agent task" })).toHaveText(
    "Task"
  );
  await expect(page.getByLabel("System prompt override")).toHaveValue(
    instructions
  );
  await expect(
    page.getByRole("checkbox", { name: /^Require approval for tool calls/ })
  ).toBeChecked();
  await page.getByLabel("System prompt override").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath("scheduled-task.png"),
    fullPage: true,
  });
});

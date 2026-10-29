import { expect, test } from "@playwright/test";
import {
  flowPayload,
  fulfillJson,
  setupWorkflowsPage,
  openAgentInspector,
} from "./helpers/flows-inspector-layout-fixtures";
import type { FlowGraph } from "@/lib/types";

test("switching Repeat preserves the schedule and timestamp and validates the offset", async ({
  page,
}) => {
  await setupWorkflowsPage(page);
  const graph = structuredClone(flowPayload.draft_graph) as FlowGraph;
  graph.nodes.find((node) => node.type === "start")!.data = {
    label: "Scheduled",
    event: "schedule",
    scheduleCron: "17 14 * * 2",
    scheduleTimezone: "America/New_York",
    filter: {
      scope: "org",
      installationIds: [101],
      repos: ["webrenew/blackbox"],
    },
  };
  const payload = { ...flowPayload, draft_graph: graph };
  await page.route("**/api/flows", (route) => fulfillJson(route, [payload]));
  await page.route("**/api/flows/flow-1", (route) =>
    fulfillJson(route, payload)
  );
  await page.goto("/alex/workflows");
  await page.locator('.react-flow__node[data-id="start"]').click();
  const repeat = page.getByRole("combobox", { name: "Repeat", exact: true });
  await repeat.click();
  await page.getByRole("option", { name: "Run once", exact: true }).click();
  const runAt = page.getByTestId("flow-trigger-run-at");
  await runAt.focus();
  await page.keyboard.press("Tab");
  await expect(runAt).toHaveAttribute("aria-invalid", "true");
  await runAt.fill("2027-01-16T16:00:00-05:00");
  await repeat.click();
  await page.getByRole("option", { name: "Recurring", exact: true }).click();
  await expect(page.getByTestId("flow-trigger-schedule-cron")).toHaveValue(
    "17 14 * * 2"
  );
  await expect(page.getByTestId("flow-trigger-schedule-timezone")).toHaveValue(
    "America/New_York"
  );
  await repeat.click();
  await page.getByRole("option", { name: "Run once", exact: true }).click();
  await expect(runAt).toHaveValue("2027-01-16T16:00:00-05:00");
  await runAt.fill("2027-01-16T16:00:00");
  await page.keyboard.press("Tab");
  await expect(runAt).toHaveAttribute("aria-invalid", "true");
  await expect(
    page.getByRole("alert").filter({ hasText: "explicit timezone offset" })
  ).toBeVisible();
  await runAt.fill("2027-01-16T16:00:00-05:00");
  await expect(runAt).toHaveAttribute("aria-invalid", "false");
});

test("one-time schedule survives editing, save and reload without a recurring cron", async ({
  page,
}, testInfo) => {
  await setupWorkflowsPage(page);
  let graph = structuredClone(flowPayload.draft_graph) as FlowGraph;
  const start = graph.nodes.find((node) => node.type === "start")!;
  start.data = {
    label: "Run once",
    event: "schedule",
    scheduleRunAt: "2027-01-15T15:00:00-05:00",
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
  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");
  await page.locator('.react-flow__node[data-id="start"]').click();
  await expect(
    page.getByRole("combobox", { name: "Repeat", exact: true })
  ).toHaveText("Run once");
  await expect(page.getByTestId("flow-library-current-trigger")).toContainText(
    "One-time trigger"
  );
  const timestamp = "2027-01-16T16:00:00-05:00";
  await page.getByTestId("flow-trigger-run-at").fill(timestamp);
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/flows/flow-1") &&
      response.request().method() === "PUT"
  );
  await page.keyboard.press("ControlOrMeta+s");
  await saved;
  expect(
    graph.nodes.find((node) => node.type === "start")!.data.scheduleCron
  ).toBeUndefined();
  await page.reload();
  await page.keyboard.press("Escape");
  await page.locator('.react-flow__node[data-id="start"]').click();
  await expect(page.getByTestId("flow-trigger-run-at")).toHaveValue(timestamp);
  await page.screenshot({
    path: testInfo.outputPath("run-once.png"),
    fullPage: true,
  });
});

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

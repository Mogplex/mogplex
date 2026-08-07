import { expect, test } from "@playwright/test";
import { selectAppOption } from "./helpers/app-select";
import { FLOW_AGENT_DEFAULT_MAX_STEPS } from "../../lib/flows/agent-defaults";
import { AUTOMATION_MODEL_DEFAULT_TIMEOUT_MS } from "../../lib/workflows/automation-model-defaults";
import {
  stubFlowsPage,
  primaryModifier,
} from "./helpers/flows-pane-keyboard-fixtures";
import type { FlowNode } from "../../lib/types";

const defaultTimeoutSeconds = Math.round(
  AUTOMATION_MODEL_DEFAULT_TIMEOUT_MS / 1000
);
const defaultMaxStepsPlaceholder = `${FLOW_AGENT_DEFAULT_MAX_STEPS} (default)`;
const defaultTimeoutPlaceholder = `${defaultTimeoutSeconds} (default)`;

test("select all and escape only affect agent-node selection and preserve structural nodes", async ({
  page,
}) => {
  // Width must be >= 1520 so the flows container (minus ~240px sidebar) exceeds
  // the 1280px dock-mode threshold.
  await page.setViewportSize({ width: 1600, height: 900 });
  await stubFlowsPage(page);

  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");

  const selectedNodes = page.locator(".react-flow__node.selected");
  const initialNodeCount = await page.locator(".react-flow__node").count();

  await page.locator(".flows-pane-grid > section").click();
  await page.keyboard.press(`${primaryModifier}+A`);
  await expect(
    page.locator(".react-flow__node.selected").filter({ hasText: "Reviewer A" })
  ).toHaveCount(1);
  await expect(
    page.locator(".react-flow__node.selected").filter({ hasText: "Reviewer B" })
  ).toHaveCount(1);
  await expect(
    page.locator(".react-flow__node.selected").filter({ hasText: "PR opened" })
  ).toHaveCount(0);
  await expect(
    page.locator(".react-flow__node.selected").filter({ hasText: "Done" })
  ).toHaveCount(0);

  await page
    .locator(".react-flow__node")
    .filter({ hasText: "PR opened" })
    .click();
  await page.keyboard.press("Delete");
  expect(
    await page.locator(".react-flow__node").count()
  ).toBeGreaterThanOrEqual(initialNodeCount);
  await expect(
    page.locator(".react-flow__node").filter({ hasText: "PR opened" })
  ).toHaveCount(1);
  await expect(
    page.locator(".react-flow__node").filter({ hasText: "Done" })
  ).toHaveCount(1);

  await page.keyboard.press("Escape");
  await expect(selectedNodes).toHaveCount(0);
});

test("agent node overrides persist to the flow graph without mutating the base agent catalog", async ({
  page,
}) => {
  const { getFlow, getAgentRequestMethods } = await stubFlowsPage(page);

  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");

  await page
    .locator(".react-flow__node")
    .filter({ hasText: "Reviewer A" })
    .click();
  await selectAppOption(page.getByLabel("Agent task"), "edit");
  await selectAppOption(
    page.getByLabel("Model", { exact: true }),
    "minimax/minimax-m2.5"
  );
  const maxStepsOverride = page.getByLabel("Max steps override");
  const timeoutOverride = page.getByLabel("Timeout override (seconds)");
  await expect(maxStepsOverride).toHaveAttribute(
    "placeholder",
    defaultMaxStepsPlaceholder
  );
  await expect(timeoutOverride).toHaveAttribute(
    "placeholder",
    defaultTimeoutPlaceholder
  );
  await maxStepsOverride.fill("42");
  await timeoutOverride.fill("18");
  await page
    .getByLabel("System prompt override")
    .fill("Focus on correctness regressions before style issues.");
  await page.keyboard.press(`${primaryModifier}+S`);

  await expect
    .poll(() => {
      const agentNode = (getFlow().draft_graph.nodes as FlowNode[]).find(
        (node) => node.id === "agent-a"
      );
      return agentNode?.data;
    })
    .toMatchObject({
      label: "Reviewer A",
      agentId: "agent-a",
      role: "edit",
      modelOverride: "minimax/minimax-m2.5",
      maxStepsOverride: 42,
      timeoutMsOverride: 18000,
      systemPromptOverride:
        "Focus on correctness regressions before style issues.",
    });

  expect(
    getAgentRequestMethods().every((method) => method === "GET")
  ).toBeTruthy();
});

test("agent nodes persist an available CLI harness and disable missing-key harnesses", async ({
  page,
}) => {
  // Width must be >= 1520 so the flows container (minus ~240px sidebar) exceeds
  // the 1280px dock-mode threshold.
  await page.setViewportSize({ width: 1600, height: 900 });
  const { getFlow } = await stubFlowsPage(page);

  await page.goto("/alex/workflows?tab=editor");
  await page.waitForLoadState("networkidle");

  const agentNode = page
    .locator(".react-flow__node")
    .filter({ hasText: "Reviewer A" });
  await expect(
    agentNode.getByTestId("flow-canvas-harness-icon-mogplex")
  ).toBeVisible();
  await expect(agentNode).toContainText("Mogplex");
  await expect(agentNode).not.toContainText("agent-a");
  await agentNode.click();

  const harnessGroup = page.getByRole("radiogroup", { name: "Harness" });
  await expect(
    harnessGroup.getByRole("radio", { name: "Mogplex" })
  ).toHaveAttribute("aria-checked", "true");
  await expect(
    harnessGroup.getByRole("radio", { name: "Codex" })
  ).toBeDisabled();

  await harnessGroup.getByRole("radio", { name: "Claude Code" }).click();
  await expect(
    agentNode.getByTestId("flow-canvas-harness-icon-claude-code")
  ).toBeVisible();
  await expect(agentNode).toContainText("Claude Code");
  await expect(
    page.getByText("Claude Code runs this node inside a fresh repo sandbox")
  ).toBeVisible();
  await expect(page.getByLabel("Mogplex agent")).toHaveCount(0);
  await page.keyboard.press(`${primaryModifier}+S`);

  await expect
    .poll(() => {
      const agentNode = (getFlow().draft_graph.nodes as FlowNode[]).find(
        (node) => node.id === "agent-a"
      );
      return agentNode?.data;
    })
    .toMatchObject({
      label: "Reviewer A",
      agentId: null,
      harness: "claude-code",
    });
});

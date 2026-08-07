import { expect, test } from "@playwright/test";
import {
  stubFlowsPage,
  primaryModifier,
} from "./helpers/flows-pane-keyboard-fixtures";
import type { FlowNode } from "../../lib/types";

// 100 ms past the 900 ms autosave debounce — enough to confirm no save fires.
const autosaveSettleMs = 1000;

test("keyboard shortcuts save from text fields without hijacking text input selection", async ({
  page,
}) => {
  const { getFlow } = await stubFlowsPage(page);

  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");

  await page
    .locator(".react-flow__node")
    .filter({ hasText: "Reviewer A" })
    .click();
  const notes = page.getByPlaceholder(
    "Capture intent, guardrails, and context for this flow."
  );
  await notes.click();
  await page.keyboard.press(`${primaryModifier}+A`);
  await page.keyboard.type("Updated flow notes");
  await page.keyboard.press(`${primaryModifier}+S`);

  await expect.poll(() => getFlow().notes).toBe("Updated flow notes");
  await expect(
    page.locator(".react-flow__node.selected").filter({ hasText: "Reviewer A" })
  ).toHaveCount(1);
});

test("draft edits autosave and surface save status without a manual save click", async ({
  page,
}) => {
  const { getFlow } = await stubFlowsPage(page, {
    // Keep the PUT in flight past the 900 ms debounce so transient states are observable.
    flowUpdateDelayMs: 1200,
  });

  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");

  await page
    .locator(".react-flow__node")
    .filter({ hasText: "Reviewer A" })
    .click();
  const notes = page.getByPlaceholder(
    "Capture intent, guardrails, and context for this flow."
  );
  await notes.fill("Autosaved flow notes");

  const liveStatus = page.getByTestId("flow-save-status-live");
  await expect(page.getByTestId("flow-save-status")).toContainText(
    /Autosave queued|Autosaving/
  );
  await expect(liveStatus).toBeEmpty();
  await expect.poll(() => getFlow().notes).toBe("Autosaved flow notes");
  const status = page.getByTestId("flow-save-status");
  await expect(status).toContainText("Saved");
  await expect(liveStatus).toHaveText("Saved");
});

test("clean saved status stays visually quiet", async ({ page }) => {
  await stubFlowsPage(page);

  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");

  const status = page.getByTestId("flow-save-status");
  await expect(status).toHaveText("Saved");
  const liveStatus = page.getByTestId("flow-save-status-live");
  await expect(liveStatus).toHaveAttribute("role", "status");
  await expect(liveStatus).toBeEmpty();
  const presentation = await status.evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      backgroundColor: style.backgroundColor,
      borderTopWidth: style.borderTopWidth,
    };
  });

  expect(presentation.backgroundColor).toBe("rgba(0, 0, 0, 0)");
  expect(presentation.borderTopWidth).toBe("0px");
});

test("canvas viewport changes do not autosave without graph edits", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-04-30T12:00:00Z") });
  let flowUpdateCount = 0;
  await stubFlowsPage(page, {
    onFlowUpdate: () => {
      flowUpdateCount += 1;
    },
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".react-flow__node")).toHaveCount(4);

  // Advance past the 900ms autosave debounce after initial fit-view adjustments.
  await page.clock.runFor(autosaveSettleMs);
  // The primary regression assertion: no PUT must have fired for a
  // viewport-only change. The "Saved" text reflects the initial load state
  // rendered by stubFlowsPage (no dirty edits outstanding at page load).
  expect(flowUpdateCount).toBe(0);
  await expect(page.getByTestId("flow-save-status")).toContainText("Saved");

  await page.locator(".react-flow").click({ position: { x: 520, y: 300 } });
  // A canvas click that only changes the viewport must not trigger autosave.
  await page.clock.runFor(autosaveSettleMs);
  expect(flowUpdateCount).toBe(0);
  await expect(page.getByTestId("flow-save-status")).toContainText("Saved");
});

test("autosave does not replay an older server snapshot over newer local edits", async ({
  page,
}) => {
  let flowUpdateCount = 0;
  const { getFlow } = await stubFlowsPage(page, {
    flowUpdateDelayMs: 1800,
    onFlowUpdate: () => {
      flowUpdateCount += 1;
    },
  });

  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");

  await page
    .locator(".react-flow__node")
    .filter({ hasText: "Reviewer A" })
    .click();
  const notes = page.getByPlaceholder(
    "Capture intent, guardrails, and context for this flow."
  );
  await notes.fill("First autosave snapshot");

  await expect.poll(() => flowUpdateCount).toBe(1);

  await notes.fill("Second local edit should win");
  await expect(page.getByTestId("flow-save-status")).toContainText(
    /Autosaving|Autosave queued/
  );

  await expect
    .poll(async () => notes.inputValue())
    .toBe("Second local edit should win");

  // Confirm the persisted server payload — not just the UI field — ends on the newer edit.
  // Without this the test would pass even if a stale server echo transiently overwrote the draft,
  // as long as React re-rendered the latest value back.
  await expect.poll(() => flowUpdateCount).toBeGreaterThanOrEqual(2);
  await expect.poll(() => getFlow().notes).toBe("Second local edit should win");
});

test("adding a condition node does not let the first autosave overwrite follow-up inspector edits", async ({
  page,
}) => {
  let flowUpdateCount = 0;
  const { getFlow } = await stubFlowsPage(page, {
    flowUpdateDelayMs: 1800,
    onFlowUpdate: () => {
      flowUpdateCount += 1;
    },
  });

  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");

  await page.getByRole("button", { name: /If branch/ }).click();
  await expect(page.getByLabel("Source field")).toBeVisible();

  await expect.poll(() => flowUpdateCount).toBe(1);

  const labelInput = page.getByLabel("Label");
  await labelInput.fill("Branch on repo source");

  await expect
    .poll(async () => labelInput.inputValue())
    .toBe("Branch on repo source");

  // Verify the persisted server payload reflects the follow-up inspector edit.
  // This is the regression guard: a broken build where the first autosave echo overwrites
  // the condition-node label would still render the local input correctly but would persist
  // the original "Condition" label to the server.
  await expect.poll(() => flowUpdateCount).toBeGreaterThanOrEqual(2);
  const getConditionNodeLabel = () => {
    const nodes = (getFlow().draft_graph?.nodes ?? []) as FlowNode[];
    for (const node of nodes) {
      if (node.type === "condition") return node.data.label;
    }
    return null;
  };
  await expect.poll(getConditionNodeLabel).toBe("Branch on repo source");
});

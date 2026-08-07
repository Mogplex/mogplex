import { expect, test } from "@playwright/test";
import {
  stubFlowsPage,
  primaryModifier,
  redoShortcut,
} from "./helpers/flows-pane-keyboard-fixtures";

test("keyboard shortcuts duplicate, delete, undo, and redo canvas nodes", async ({
  page,
}) => {
  await stubFlowsPage(page);

  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");

  const canvasNodes = page.locator(".react-flow__node");
  await expect(canvasNodes).toHaveCount(4);

  await page
    .locator(".react-flow__node")
    .filter({ hasText: "Reviewer B" })
    .click();
  await page.keyboard.press(`${primaryModifier}+D`);
  await expect(canvasNodes).toHaveCount(5);

  await page.keyboard.press("Backspace");
  await expect(canvasNodes).toHaveCount(4);

  await page.keyboard.press(`${primaryModifier}+Z`);
  await expect(canvasNodes).toHaveCount(5);

  await page.keyboard.press(redoShortcut);
  await expect(canvasNodes).toHaveCount(4);
});

test("open workflow selectors own shortcuts without disabling them after close", async ({
  page,
}) => {
  await stubFlowsPage(page);

  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");

  const canvasNodes = page.locator(".react-flow__node");
  await expect(canvasNodes).toHaveCount(4);

  await canvasNodes.filter({ hasText: "Reviewer B" }).click();
  const taskSelect = page.getByLabel("Agent task");
  await taskSelect.click();
  await expect(taskSelect).toHaveAttribute("aria-expanded", "true");

  await page.keyboard.press("Backspace");
  await expect(canvasNodes).toHaveCount(4);

  await page.keyboard.press("Escape");
  await expect(taskSelect).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Backspace");
  await expect(canvasNodes).toHaveCount(3);
});

test("keyboard shortcuts copy, paste, cut, undo, and redo canvas nodes", async ({
  page,
}) => {
  // Width must be >= 1520 so the flows container (minus ~240px sidebar) exceeds
  // the 1280px dock-mode threshold.
  await page.setViewportSize({ width: 1600, height: 900 });
  await stubFlowsPage(page);

  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");

  const canvasNodes = page.locator(".react-flow__node");
  const reviewerANodes = canvasNodes.filter({ hasText: "Reviewer A" });
  const reviewerBNodes = canvasNodes.filter({ hasText: "Reviewer B" });
  await expect(canvasNodes).toHaveCount(4);

  await reviewerBNodes.click();
  await page.keyboard.press(`${primaryModifier}+C`);

  await reviewerANodes.click();
  await page.getByRole("tab", { name: "Canvas" }).evaluate((tab) => {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(tab);
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await page.keyboard.press(`${primaryModifier}+C`);
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await page.keyboard.press(`${primaryModifier}+V`);
  await expect(reviewerANodes).toHaveCount(1);
  await expect(reviewerBNodes).toHaveCount(2);
  await page.keyboard.press(`${primaryModifier}+Z`);
  await expect(canvasNodes).toHaveCount(4);

  await page.getByTestId("flows-runs-tab").click();
  await page.keyboard.press(`${primaryModifier}+V`);
  await expect(canvasNodes).toHaveCount(4);

  await page.getByRole("tab", { name: "Canvas" }).click();
  await page.keyboard.press(`${primaryModifier}+V`);
  await expect(canvasNodes).toHaveCount(4);

  await reviewerBNodes.click();
  await page.keyboard.press(`${primaryModifier}+V`);
  await expect(canvasNodes).toHaveCount(5);
  await expect(reviewerBNodes).toHaveCount(2);

  await page.keyboard.press(`${primaryModifier}+X`);
  await expect(canvasNodes).toHaveCount(4);
  await expect(reviewerBNodes).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();

  await page.keyboard.press(`${primaryModifier}+Z`);
  await expect(canvasNodes).toHaveCount(5);

  await page.keyboard.press(redoShortcut);
  await expect(canvasNodes).toHaveCount(4);
});

import { expect, test } from "@playwright/test";
import {
  setupWorkflowsPage,
  normalizeCssColors,
} from "./helpers/flows-pane-theme-fixtures";

test("workflows builder and portalled surfaces follow the light app theme", async ({
  page,
}, testInfo) => {
  await setupWorkflowsPage(page, "light");

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");

  // Prove the premise: the surrounding app really is in its light theme.
  await expect(page.locator("html")).not.toHaveClass(/dark/);

  // React Flow's own color mode has to track the app theme, not the OS.
  await expect(page.locator(".react-flow.light")).toBeVisible();
  await expect(page.locator(".react-flow.dark")).toHaveCount(0);

  const paneStyles = await page.locator(".flows-pane").evaluate((node) => {
    const styles = getComputedStyle(node);
    return {
      themeBackground: styles.getPropertyValue("--background").trim(),
      backgroundColor: styles.backgroundColor,
      color: styles.color,
      colorScheme: styles.colorScheme,
    };
  });
  const [
    expectedLightBackground,
    actualLightBackground,
    expectedLightForeground,
    actualLightForeground,
    expectedLightCard,
  ] = await normalizeCssColors(page, [
    "#f7f5ef",
    paneStyles.backgroundColor,
    "#191712",
    paneStyles.color,
    "#fdfcf9",
  ]);
  expect(paneStyles.themeBackground).not.toBe("");
  expect(actualLightBackground).toBe(expectedLightBackground);
  expect(actualLightForeground).toBe(expectedLightForeground);
  expect(paneStyles.colorScheme).toBe("light");

  const canvasThemeColors = await page
    .locator(".flows-canvas")
    .evaluate((node) => {
      const styles = getComputedStyle(node);
      return {
        canvasBackground: styles
          .getPropertyValue("--xy-background-color")
          .trim(),
        themeBackground: styles.getPropertyValue("--background").trim(),
      };
    });
  expect(canvasThemeColors.canvasBackground).toBe(
    canvasThemeColors.themeBackground
  );
  const canvasBg = await page
    .locator(".react-flow__background")
    .evaluate((node) => getComputedStyle(node).backgroundColor);
  expect((await normalizeCssColors(page, [canvasBg]))[0]).toBe(
    expectedLightBackground
  );

  // Node cards must sit on a light surface too — they are the one place that
  // still paints its own background rather than inheriting the canvas.
  const nodeCardBackgrounds = await page
    .locator(".flows-node-card")
    .evaluateAll((nodes) =>
      nodes.map((node) => getComputedStyle(node).backgroundColor)
    );
  expect(nodeCardBackgrounds.length).toBeGreaterThan(0);
  const normalizedLightNodeCards = await normalizeCssColors(
    page,
    nodeCardBackgrounds
  );
  expect(
    normalizedLightNodeCards.every(
      (background) => background === expectedLightCard
    )
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("flows-pane-light-theme.png"),
    fullPage: true,
  });

  // The context menu portals to document.body, outside `.flows-pane`, and
  // relies on `.flows-theme` to pick up the same palette.
  await page
    .locator(".react-flow__pane")
    .click({ button: "right", position: { x: 200, y: 60 } });
  const contextMenu = page.getByTestId("flow-context-menu");
  await expect(contextMenu).toBeVisible();
  const menuStyles = await contextMenu.evaluate((node) => {
    const styles = getComputedStyle(node);
    return {
      insidePane: Boolean(node.closest(".flows-pane")),
      hasFlowsTheme: node.classList.contains("flows-theme"),
      themeBackground: styles.getPropertyValue("--background").trim(),
      backgroundColor: styles.backgroundColor,
      color: styles.color,
    };
  });
  expect(menuStyles.insidePane).toBe(false);
  expect(menuStyles.hasFlowsTheme).toBe(true);
  expect(menuStyles.themeBackground).not.toBe("");
  expect(menuStyles.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
  expect((await normalizeCssColors(page, [menuStyles.color]))[0]).toBe(
    expectedLightForeground
  );
  await page.keyboard.press("Escape");
  await expect(contextMenu).not.toBeVisible();

  // The run-details dialog also portals to document.body and must carry the
  // light palette via `.flows-theme`.
  await page.getByTestId("flows-runs-tab").click();
  await page.getByTestId("flow-run-card-run-1").click();
  const runDialog = page.locator('[data-slot="dialog-content"]');
  await expect(runDialog).toBeVisible();
  await expect(runDialog.getByText("Overview")).toBeVisible();
  const dialogStyles = await runDialog.evaluate((node) => {
    const styles = getComputedStyle(node);
    return {
      insidePane: Boolean(node.closest(".flows-pane")),
      hasFlowsTheme: node.classList.contains("flows-theme"),
      backgroundColor: styles.backgroundColor,
      color: styles.color,
    };
  });
  expect(dialogStyles.insidePane).toBe(false);
  expect(dialogStyles.hasFlowsTheme).toBe(true);
  const [dialogBackground, dialogForeground] = await normalizeCssColors(page, [
    dialogStyles.backgroundColor,
    dialogStyles.color,
  ]);
  expect(dialogBackground).toBe(expectedLightBackground);
  expect(dialogForeground).toBe(expectedLightForeground);
});

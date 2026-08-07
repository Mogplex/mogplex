import { expect, test } from "@playwright/test";
import { setupWorkflowsPage } from "./helpers/flows-inspector-layout-fixtures";

test("assistant panel keeps its own scroller inside the sheet", async ({
  page,
}) => {
  await setupWorkflowsPage(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");
  await page.getByTestId("flow-assistant-toggle").click();
  await expect(page.getByTestId("flow-assistant-panel")).toBeVisible();

  const measure = () =>
    page.evaluate(() => {
      const el = (testId: string) =>
        document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
      const sheet = el("flows-right-sheet");
      const root = el("flow-assistant-panel");
      const transcript = el("flow-assistant-transcript");
      if (!sheet || !root || !transcript) return null;
      const rootRect = root.getBoundingClientRect();
      return {
        panelOverflow: root.scrollHeight - root.clientHeight,
        panelTop: rootRect.top,
        panelBottom: rootRect.bottom,
        sheetTop: sheet.getBoundingClientRect().top,
        sheetBottom: sheet.getBoundingClientRect().bottom,
        transcriptHeight: transcript.getBoundingClientRect().height,
        transcriptTop: transcript.getBoundingClientRect().top,
        transcriptOverflowY: getComputedStyle(transcript).overflowY,
      };
    });

  // The assistant shares the sheet with the inspector, and the sheet went from
  // scrolling itself to `flex-col overflow-hidden`. The panel therefore has to
  // fit the sheet and scroll internally, or its transcript is clipped with no
  // way back to it.
  const roomy = await measure();
  expect(roomy).not.toBeNull();
  expect(roomy!.panelOverflow).toBeLessThanOrEqual(1);
  expect(roomy!.panelTop).toBeGreaterThanOrEqual(roomy!.sheetTop - 1);
  expect(roomy!.panelBottom).toBeLessThanOrEqual(roomy!.sheetBottom + 1);
  expect(roomy!.transcriptOverflowY).toBe("auto");

  // Squeezed, the transcript is what gives way -- it stays on screen and keeps
  // its own scroller instead of the header or composer being pushed out.
  await page.setViewportSize({ width: 1280, height: 380 });
  await expect
    .poll(async () => (await measure())!.transcriptHeight)
    .toBeLessThan(roomy!.transcriptHeight);
  const squeezed = await measure();
  expect(squeezed!.transcriptHeight).toBeGreaterThan(0);
  expect(squeezed!.transcriptOverflowY).toBe("auto");
  expect(squeezed!.transcriptTop).toBeGreaterThanOrEqual(
    squeezed!.panelTop - 1
  );
  expect(squeezed!.panelBottom).toBeLessThanOrEqual(squeezed!.sheetBottom + 1);
});

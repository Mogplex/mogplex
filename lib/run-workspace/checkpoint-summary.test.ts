import { expect, test } from "vitest";
import { checkpointSummaryLead } from "./checkpoint-summary";

test("keeps the human summary visible before longer review sections", () => {
  expect(
    checkpointSummaryLead(
      "Add commit signing.\n\n## Changes\n- Settings\n\n## Risks\n- Key storage"
    )
  ).toBe("Add commit signing.");
});
test("legacy one-paragraph plans have a bounded lead without losing Unicode characters", () => {
  const summary = "🔑 ".repeat(150);
  const lead = checkpointSummaryLead(summary);
  expect(Array.from(lead).length).toBeLessThanOrEqual(220);
  expect(lead.endsWith("…")).toBe(true);
  expect(lead).not.toContain("\uFFFD");
  expect(checkpointSummaryLead("  ## A short plan\nwith two lines  ")).toBe(
    "A short plan with two lines"
  );
  expect(checkpointSummaryLead("  ")).toBe("");
});

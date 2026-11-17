import { expect, test } from "vitest";
import {
  checkpointSummaryLead,
  checkpointSummaryDetails,
} from "./checkpoint-summary";

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

test("expanded details preserve long legacy leads and avoid duplicating a short structured lead", () => {
  expect(checkpointSummaryDetails("Ready.\n\n## Changes\nAdd signing.")).toBe(
    "## Changes\nAdd signing."
  );
  const long = "x".repeat(300) + "\n\nMore detail";
  expect(checkpointSummaryDetails(long)).toBe(long);
  expect(checkpointSummaryDetails("Single paragraph")).toBe("Single paragraph");
});

test("truncated lead paragraphs are never removed from the full details", () => {
  for (const size of [219, 220, 221]) {
    const lead = "x".repeat(size);
    const full = lead + "\n\nDetails";
    expect(Array.from(checkpointSummaryLead(full)).length).toBeLessThanOrEqual(
      220
    );
    expect(checkpointSummaryDetails(full)).toBe(size > 220 ? full : "Details");
  }
});

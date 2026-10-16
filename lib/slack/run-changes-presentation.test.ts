import { expect, it } from "vitest";
import type { BranchChangedFile } from "@/lib/sandbox/branch-changes";
import type { RunChanges } from "./run-changes";
import {
  buildRunChangesModal,
  changesSectionText,
  patchBody,
} from "./run-changes-presentation";

process.env.NEXT_PUBLIC_APP_URL ||= "https://mogplex.com";

const RUN_ID = "00000000-0000-4000-8000-000000000001";

function file(index: number, lines = 3): BranchChangedFile {
  return {
    path: `src/file-${index}.ts`,
    status: "modified",
    additions: lines,
    deletions: 0,
    patch: `diff --git a/src/file-${index}.ts b/src/file-${index}.ts\nindex 1..2 100644\n--- a/src/file-${index}.ts\n+++ b/src/file-${index}.ts\n@@ -1 +1,${lines} @@\n${"+line of new code\n".repeat(lines)}`,
  };
}

function changes(files: BranchChangedFile[]): RunChanges {
  return {
    files,
    patchTruncated: false,
    source: "workspace",
    baseBranch: "main",
    branch: "agent/fix",
  };
}

function textOf(blocks: Record<string, unknown>[]) {
  return JSON.stringify(blocks);
}

it("should summarize the first files and count the rest on the result card", () => {
  const text = changesSectionText(
    Array.from({ length: 7 }, (_, index) => file(index))
  );

  expect(text).toContain("*Changes*\n7 files changed · +21 −0");
  expect(text).toContain("`src/file-0.ts` +3 −0");
  expect(text).toContain("…and 2 more files");
  expect(text).not.toContain("src/file-5.ts");
});

it("should render each file's hunks without git header lines", () => {
  const modal = buildRunChangesModal({
    runId: RUN_ID,
    state: "ready",
    changes: changes([file(1)]),
  });

  const rendered = textOf(modal.blocks);
  expect(rendered).toContain("rich_text_preformatted");
  expect(rendered).toContain("@@ -1 +1,3 @@");
  expect(rendered).not.toContain("index 1..2");
  expect(rendered).toContain("Includes uncommitted work");
});

it("should stay within Slack's modal limits for a large change set", () => {
  const modal = buildRunChangesModal({
    runId: RUN_ID,
    state: "ready",
    changes: changes(
      Array.from({ length: 120 }, (_, index) => file(index, 200))
    ),
  });

  expect(modal.blocks.length).toBeLessThanOrEqual(100);
  expect(modal.title.text.length).toBeLessThanOrEqual(24);
  for (const block of modal.blocks) {
    const longest = Math.max(
      0,
      ...JSON.stringify(block)
        .split(/"text":"/)
        .slice(1)
        .map((part) => part.split(/(?<!\\)"/)[0].length)
    );
    expect(longest).toBeLessThan(3_100);
  }
  expect(textOf(modal.blocks)).toMatch(/\d+ more files not shown here/);
  expect(textOf(modal.blocks)).toContain("more lines not shown");
});

it("should explain a file with no diff instead of showing an empty block", () => {
  const binary = { ...file(1), patch: undefined };
  const modal = buildRunChangesModal({
    runId: RUN_ID,
    state: "ready",
    changes: changes([binary]),
  });

  expect(textOf(modal.blocks)).toContain("Diff not available for this file");
});

it("should link the GitHub compare page when the diff came from the pushed branch", () => {
  const modal = buildRunChangesModal({
    runId: RUN_ID,
    state: "ready",
    changes: {
      ...changes([]),
      source: "github",
      webUrl: "https://github.com/acme/app/compare/main...agent/fix",
    },
  });

  const rendered = textOf(modal.blocks);
  expect(rendered).toContain("No changes yet.");
  expect(rendered).toContain("|Open on GitHub>");
  expect(rendered).toContain("Uncommitted work is not included");
});

it("should keep GitHub patches that have no git header", () => {
  expect(patchBody("@@ -1 +1 @@\n-a\n+b")).toBe("@@ -1 +1 @@\n-a\n+b");
});

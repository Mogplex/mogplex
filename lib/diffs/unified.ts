import { structuredPatch } from "diff";

/**
 * Build a unified diff for one file so tool results render in the patch
 * viewer. `before: null` means the file did not exist. Returns "" when the
 * contents are identical.
 */
export function buildUnifiedDiff(input: {
  path: string;
  before: string | null;
  after: string;
}): string {
  const before = input.before ?? "";
  if (before === input.after) return "";
  const patch = structuredPatch(input.path, input.path, before, input.after);
  if (patch.hunks.length === 0) return "";
  const oldHeader = input.before === null ? "/dev/null" : `a/${input.path}`;
  const lines = [`--- ${oldHeader}`, `+++ b/${input.path}`];
  for (const hunk of patch.hunks) {
    lines.push(
      `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
      ...hunk.lines
    );
  }
  return `${lines.join("\n")}\n`;
}

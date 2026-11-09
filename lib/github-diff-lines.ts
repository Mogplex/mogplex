/**
 * Lines a review comment can attach to, by path: the new-file lines that a
 * pull request's diff shows (added and context lines). An empty list means
 * the file changed but GitHub sent no patch (binary or too large).
 */
export type PrChangedLines = Map<string, number[]>;

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/** New-file line numbers a unified-diff patch shows on its right side. */
export function parsePatchRightLines(patch: string): number[] {
  const lines: number[] = [];
  let next = 0;
  // Right-side rows the current hunk still has, from its header. Counting
  // them keeps a trailing newline from adding a line past the hunk.
  let remaining = 0;
  for (const row of patch.split("\n")) {
    const header = HUNK_HEADER.exec(row);
    if (header) {
      next = Number(header[1]);
      remaining = header[2] ? Number(header[2]) : 1;
      continue;
    }
    if (remaining === 0 || row.startsWith("-") || row.startsWith("\\"))
      continue;
    lines.push(next);
    next += 1;
    remaining -= 1;
  }
  return lines;
}

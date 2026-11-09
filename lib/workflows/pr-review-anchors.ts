import type { ReviewFinding } from "@/lib/types";

/**
 * Lines a review comment can attach to, by path: the new-file lines that a
 * pull request's diff shows (added and context lines). An empty list means
 * the file changed but GitHub sent no patch (binary or too large).
 */
export type PrChangedLines = Map<string, number[]>;

export type AnchoredReviewComment = {
  path: string;
  line: number;
  finding: ReviewFinding;
  /** How the comment's line relates to the line the finding names. */
  anchor: "exact" | "nearest" | "file";
};

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

function nearestLine(lines: number[], target: number | null) {
  if (target == null) return lines[0];
  let best = lines[0];
  for (const line of lines) {
    if (Math.abs(line - target) < Math.abs(best - target)) best = line;
  }
  return best;
}

/**
 * Attach each finding to a line GitHub accepts a comment on. A finding whose
 * line is in the diff keeps it; one whose line is outside the diff, or that
 * names no line, goes on the nearest changed line of its file. A finding for
 * a file the diff does not show, or with no path, is not anchored and stays
 * in the review summary. Without diff data (`changed` is null) only findings
 * that name a path and a line are anchored, as they are.
 */
export function anchorReviewFindings(
  findings: ReviewFinding[],
  changed: PrChangedLines | null
) {
  const comments: AnchoredReviewComment[] = [];
  const unanchored: ReviewFinding[] = [];
  for (const finding of findings) {
    if (!finding.path) {
      unanchored.push(finding);
      continue;
    }
    if (!changed) {
      if (finding.line == null) unanchored.push(finding);
      else
        comments.push({
          path: finding.path,
          line: finding.line,
          finding,
          anchor: "exact",
        });
      continue;
    }
    const lines = changed.get(finding.path) ?? [];
    if (lines.length === 0) {
      unanchored.push(finding);
      continue;
    }
    if (finding.line != null && lines.includes(finding.line)) {
      comments.push({
        path: finding.path,
        line: finding.line,
        finding,
        anchor: "exact",
      });
      continue;
    }
    comments.push({
      path: finding.path,
      line: nearestLine(lines, finding.line),
      finding,
      anchor: finding.line == null ? "file" : "nearest",
    });
  }
  return { comments, unanchored };
}

/** A note for a comment that does not sit on the line its finding names. */
export function describeReviewAnchor(comment: AnchoredReviewComment) {
  if (comment.anchor === "file") return "_About this file as a whole._";
  if (comment.anchor === "nearest")
    return `_About line ${comment.finding.line}, which this diff does not show._`;
  return null;
}

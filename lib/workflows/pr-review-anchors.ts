import type { PrChangedLines } from "@/lib/github-diff-lines";
import type { ReviewFinding } from "@/lib/types";

export type AnchoredReviewComment = {
  path: string;
  line: number;
  finding: ReviewFinding;
  /** How the comment's line relates to the line the finding names. */
  anchor: "exact" | "nearest" | "file";
};

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
    // Model-written paths can carry stray whitespace.
    const path = finding.path?.trim();
    if (!path) {
      unanchored.push(finding);
      continue;
    }
    if (!changed) {
      if (finding.line == null) unanchored.push(finding);
      else
        comments.push({
          path,
          line: finding.line,
          finding,
          anchor: "exact",
        });
      continue;
    }
    const lines = changed.get(path) ?? [];
    if (lines.length === 0) {
      unanchored.push(finding);
      continue;
    }
    if (finding.line != null && lines.includes(finding.line)) {
      comments.push({
        path,
        line: finding.line,
        finding,
        anchor: "exact",
      });
      continue;
    }
    comments.push({
      path,
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

/**
 * Patch building utilities for PR file updates.
 * @module
 */

function splitPatchLines(normalizedContent: string) {
  if (normalizedContent.length === 0) return [];
  return normalizedContent.endsWith("\n")
    ? normalizedContent.slice(0, -1).split("\n")
    : normalizedContent.split("\n");
}

function parsePatchContent(content: string) {
  const normalized = content.replace(/\r\n/g, "\n");
  return {
    lines: splitPatchLines(normalized),
    missingTrailingNewline: normalized.length > 0 && !normalized.endsWith("\n"),
  };
}

function formatPatchRange(lines: string[], created: boolean) {
  if (lines.length === 0) return created ? "0,0" : "1,0";
  return `1,${lines.length}`;
}

/**
 * Builds a coarse unified diff that replaces the entire file: every old line is
 * emitted as a deletion and every new line as an addition. This is intentionally
 * a full-replacement diff rather than a minimal hunk — the renderer in the Edits
 * section just needs valid unified-diff syntax, and avoiding a real diff library
 * keeps this tool dependency-free. The trade-off is that small edits show up as
 * full-file rewrites; callers should treat the patch as informational only.
 *
 * Returns `null` when the new content is identical to the previous content, so
 * no-op writes don't render as a misleading full rewrite.
 */
export function buildUpdateFilePatch(
  path: string,
  previousContent: string | null,
  nextContent: string
): string | null {
  if (previousContent !== null && previousContent === nextContent) {
    return null;
  }

  const oldContent =
    previousContent == null ? null : parsePatchContent(previousContent);
  const newContent = parsePatchContent(nextContent);
  const oldLines = oldContent?.lines ?? [];
  const newLines = newContent.lines;
  const oldRange = formatPatchRange(oldLines, previousContent == null);
  const newRange = formatPatchRange(newLines, false);

  const patchLines = [
    `diff --git a/${path} b/${path}`,
    previousContent == null
      ? "new file mode 100644"
      : "index 0000000..0000000 100644",
    previousContent == null ? "--- /dev/null" : `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${oldRange} +${newRange} @@`,
  ];

  for (const [index, line] of oldLines.entries()) {
    patchLines.push(`-${line}`);
    if (oldContent?.missingTrailingNewline && index === oldLines.length - 1) {
      patchLines.push("\\ No newline at end of file");
    }
  }

  for (const [index, line] of newLines.entries()) {
    patchLines.push(`+${line}`);
    if (newContent.missingTrailingNewline && index === newLines.length - 1) {
      patchLines.push("\\ No newline at end of file");
    }
  }

  return patchLines.join("\n");
}

/**
 * Lightweight unified-patch detection for the control timeline.
 *
 * This intentionally does NOT use `@pierre/diffs` (lib/diffs/detect.ts):
 * that package is ESM-only ("import" condition exclusively), which the
 * node:test unit tier cannot require. The heavy parse still happens at
 * render time in the browser via PatchViewer; here we only need to
 * recognize a patch and compute per-file stats.
 */

import type { DiffFile } from "@/lib/control/types";

const PRIORITY_PATCH_KEYS = new Set([
  "patch",
  "diff",
  "stdout",
  "stderr",
  "output",
  "content",
  "text",
  "result",
]);

function looksLikePatch(text: string): boolean {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return false;

  if (/^diff --git /m.test(normalized)) return true;
  if (
    /^@@ [^@]+ @@/m.test(normalized) &&
    /^--- /m.test(normalized) &&
    /^\+{3} /m.test(normalized)
  ) {
    return true;
  }

  return false;
}

/**
 * Deep-search a tool input/output value for a string that looks like a
 * unified patch. Mirrors the traversal of detectPatchInValue: priority keys
 * first, arrays and plain objects, depth-capped.
 */
export function extractPatchFromValue(
  value: unknown,
  seen = new WeakSet<object>(),
  depth = 0
): string | null {
  if (typeof value === "string") {
    const normalized = value.replace(/\r\n/g, "\n").trim();
    return looksLikePatch(normalized) ? normalized : null;
  }

  if (value == null || typeof value !== "object" || depth > 2) {
    return null;
  }
  if (seen.has(value)) return null;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractPatchFromValue(item, seen, depth + 1);
      if (found) return found;
    }
    return null;
  }

  const entries = Object.entries(value).sort((left, right) => {
    const leftPriority = PRIORITY_PATCH_KEYS.has(left[0]) ? 1 : 0;
    const rightPriority = PRIORITY_PATCH_KEYS.has(right[0]) ? 1 : 0;
    return rightPriority - leftPriority;
  });
  for (const [, nestedValue] of entries) {
    const found = extractPatchFromValue(nestedValue, seen, depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * Per-file add/del stats for a unified patch: one entry per file section,
 * counted from hunk lines (headers excluded).
 */
export function diffFilesFromPatch(patch: string): DiffFile[] {
  const sections = patch.split(/^diff --git .*$/m).filter((s) => s.trim());
  const names = patch.match(/^diff --git a\/(.+?) b\/.+$/gm) ?? [];

  return sections.map((section, index) => {
    let add = 0;
    let del = 0;
    let path: string | undefined;
    for (const line of section.split("\n")) {
      if (line.startsWith("+++ ")) {
        path = line.slice(4).replace(/^b\//, "").trim();
      } else if (line.startsWith("+")) {
        add += 1;
      } else if (line.startsWith("-") && !line.startsWith("--- ")) {
        del += 1;
      }
    }
    return {
      path:
        path ??
        names[index]?.replace(/^diff --git a\/(.+?) b\/.+$/, "$1") ??
        "(unknown)",
      add: `+${add}`,
      del: `-${del}`,
    };
  });
}

import { parsePatchFiles } from "@pierre/diffs";
import type { FileDiffMetadata } from "@pierre/diffs";
import type { ReactNode } from "react";

const PATCH_LANGUAGES = new Set(["diff", "patch"]);
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

export type DetectedPatch = {
  patch: string;
  files: FileDiffMetadata[];
  sourcePath?: string;
};

function normalizePatch(text: string) {
  return text.replace(/\r\n/g, "\n").trim();
}

export function extractTextContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node.map(extractTextContent).join("");
  }

  if (node && typeof node === "object" && "props" in node) {
    const { props } = node as { props?: { children?: ReactNode } };
    return extractTextContent(props?.children ?? "");
  }

  return "";
}

export function getLanguageFromClassName(className?: string) {
  if (!className) return;

  const match = /language-([\d+a-z-]+)/i.exec(className);
  return match?.[1]?.toLowerCase();
}

export function looksLikePatch(text: string) {
  const normalized = normalizePatch(text);
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

export function detectPatch(
  text: string,
  language?: string
): DetectedPatch | null {
  const normalized = normalizePatch(text);
  const normalizedLanguage = language?.toLowerCase();

  if (!normalized) return null;

  const isLikelyPatch =
    (normalizedLanguage && PATCH_LANGUAGES.has(normalizedLanguage)) ||
    looksLikePatch(normalized);
  if (!isLikelyPatch) return null;

  try {
    const files = parsePatchFiles(normalized, undefined, true).flatMap(
      (entry) => entry.files
    );
    if (files.length === 0) return null;
    return { patch: normalized, files };
  } catch {
    return null;
  }
}

function sortEntries(entries: Array<[string, unknown]>) {
  return [...entries].sort((left, right) => {
    const leftPriority = PRIORITY_PATCH_KEYS.has(left[0]) ? 1 : 0;
    const rightPriority = PRIORITY_PATCH_KEYS.has(right[0]) ? 1 : 0;
    return rightPriority - leftPriority;
  });
}

export function detectPatchInValue(
  value: unknown,
  path = "",
  seen = new WeakSet<object>(),
  depth = 0
): DetectedPatch | null {
  if (typeof value === "string") {
    const detected = detectPatch(value);
    return detected ? { ...detected, sourcePath: path || undefined } : null;
  }

  if (value == null || typeof value !== "object" || depth > 2) {
    return null;
  }

  if (seen.has(value)) {
    return null;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const detected = detectPatchInValue(
        value[index],
        `${path}[${index}]`,
        seen,
        depth + 1
      );
      if (detected) return detected;
    }
    return null;
  }

  for (const [key, nestedValue] of sortEntries(Object.entries(value))) {
    const nextPath = path ? `${path}.${key}` : key;
    const detected = detectPatchInValue(nestedValue, nextPath, seen, depth + 1);
    if (detected) return detected;
  }

  return null;
}

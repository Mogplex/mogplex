"use client";

import { useEffect, useState } from "react";
import type { CodeHighlighterPlugin } from "streamdown";

let codeHighlighter: Promise<CodeHighlighterPlugin> | undefined;

/** Share completion across message effects and consumers waiting for readiness. */
export function loadCodeHighlighter() {
  codeHighlighter ??= import("@streamdown/code")
    .then((module) => module.code)
    .catch((error) => {
      codeHighlighter = undefined;
      throw error;
    });
  return codeHighlighter;
}

/** Keep the grammar bundle out of ordinary text messages and initial JS. */
export function useCodeHighlighting(content: string | undefined) {
  const [code, setCode] = useState<CodeHighlighterPlugin>();
  // Include nested fences and Markdown's space/tab-indented code blocks.
  const hasCodeBlock = /`{3,}|~{3,}|^(?: *> ?)*(?: {4,}|\t)\S/m.test(
    content ?? ""
  );

  useEffect(() => {
    if (!hasCodeBlock) return;
    let active = true;
    void loadCodeHighlighter()
      .then((plugin) => {
        if (active) setCode(plugin);
      })
      .catch((error) =>
        console.error("Failed to load code highlighting:", error)
      );
    return () => {
      active = false;
    };
  }, [hasCodeBlock]);

  return code;
}

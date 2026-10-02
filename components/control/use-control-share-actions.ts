"use client";
import { useCallback } from "react";
import type { UIMessage } from "ai";
import { scopedHref } from "@/lib/scoped-href";
import { buildTranscriptMarkdown } from "@/lib/control/export-transcript";
import { downloadTextFile } from "./download-text-file";

export function useControlShareActions({
  sessionId,
  scope,
  title,
  messages,
}: {
  sessionId: string;
  scope: string | undefined;
  title: string;
  messages: UIMessage[];
}) {
  const handleCopyLink = useCallback(() => {
    if (!sessionId) return;
    void navigator.clipboard.writeText(
      `${window.location.origin}${scopedHref(scope, "/control")}?mission=${sessionId}`
    );
  }, [sessionId, scope]);
  const handleExportTranscript = useCallback(() => {
    if (messages.length === 0) return;
    const slug =
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "control-session";
    downloadTextFile(`${slug}.md`, buildTranscriptMarkdown(title, messages));
  }, [messages, title]);
  return { handleCopyLink, handleExportTranscript };
}

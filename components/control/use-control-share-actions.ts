"use client";
import { useCallback } from "react";
import type { UIMessage } from "ai";
import { toast } from "@/hooks/use-toast";
import { copyText } from "@/lib/clipboard";
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
  const handleCopyLink = useCallback(async () => {
    if (!sessionId) return;
    const copied = await copyText(
      `${window.location.origin}${scopedHref(scope, "/control")}?mission=${sessionId}`
    );
    if (!copied) {
      toast({
        title: "Copy failed",
        description: "Your browser blocked clipboard access.",
        variant: "destructive",
      });
    }
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

"use client";

import { useCallback, useState } from "react";
import {
  readControlComposerFiles,
  type ControlComposerFile,
} from "@/components/control/control-attachments";
import type { CommandInputAttachment } from "./command-input-types";

function presentAttachment(file: ControlComposerFile): CommandInputAttachment {
  return {
    type: file.mediaType.startsWith("image/") ? "image" : "file",
    name: file.filename || "attachment",
    mediaType: file.mediaType,
    url: file.url,
    data: file.url,
  };
}

export function useCommandInputAttachments() {
  const [attachments, setAttachments] = useState<CommandInputAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);

  const addFiles = useCallback(
    async (files: File[]) => {
      const result = await readControlComposerFiles(files, attachments.length);
      setAttachments((current) => [
        ...current,
        ...result.attachments.map(presentAttachment),
      ]);
      setAttachmentError(result.error);
    },
    [attachments.length]
  );

  const removeAttachment = useCallback((index: number) => {
    setAttachments((current) => current.filter((_, item) => item !== index));
    setAttachmentError(null);
  }, []);

  const clearAttachments = useCallback(() => {
    setAttachments([]);
    setAttachmentError(null);
  }, []);

  return {
    addFiles,
    attachmentError,
    attachments,
    clearAttachments,
    removeAttachment,
  };
}

"use client";

import { useCallback, useRef, useState, type DragEvent } from "react";
import {
  readControlComposerFiles,
  type ControlComposerFile,
} from "./control-attachments";

export function useControlFileDrop({
  disabled = false,
  existingCount,
  onAttachments,
  onError,
}: {
  disabled?: boolean;
  existingCount: number;
  onAttachments: (attachments: ControlComposerFile[]) => void;
  onError: (error: string | null) => void;
}) {
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const dragDepthRef = useRef(0);

  const addFiles = useCallback(
    async (files: File[]) => {
      if (disabled || files.length === 0) return;
      const result = await readControlComposerFiles(files, existingCount);
      if (result.attachments.length > 0) {
        onAttachments(result.attachments);
      }
      onError(result.error);
    },
    [disabled, existingCount, onAttachments, onError]
  );

  const hasFiles = (event: DragEvent<HTMLElement>) =>
    event.dataTransfer.types.includes("Files");

  const droppedFiles = (event: DragEvent<HTMLElement>) => {
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) return files;
    return Array.from(event.dataTransfer.items).flatMap((item) => {
      if (item.kind !== "file") return [];
      const file = item.getAsFile();
      return file ? [file] : [];
    });
  };

  return {
    isDraggingFiles,
    addFiles,
    dropZoneProps: {
      onDragEnter: (event: DragEvent<HTMLElement>) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        if (disabled) return;
        dragDepthRef.current += 1;
        setIsDraggingFiles(true);
      },
      onDragOver: (event: DragEvent<HTMLElement>) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = disabled ? "none" : "copy";
      },
      onDragLeave: (event: DragEvent<HTMLElement>) => {
        if (!hasFiles(event)) return;
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) setIsDraggingFiles(false);
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        const files = droppedFiles(event);
        event.preventDefault();
        dragDepthRef.current = 0;
        setIsDraggingFiles(false);
        if (disabled || files.length === 0) return;
        void addFiles(files);
      },
    },
  };
}

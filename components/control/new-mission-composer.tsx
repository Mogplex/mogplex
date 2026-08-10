"use client";

import { useState, useCallback, useRef } from "react";
import {
  Attachment,
  Plus,
  SendDiagonal,
  ShieldCheck,
  ShieldXmark,
  Xmark,
} from "iconoir-react";
import { MogplexFace } from "@/components/brand/mogplex-face";
import { useModels } from "@/hooks/use-models";
import { MISSION_PERMISSION_OPTIONS } from "@/lib/control/types";
import type { Workspace } from "@/lib/control/types";
import { ModelChip, type ComposerSendOptions } from "./composer";
import {
  readControlComposerFiles,
  type ControlComposerFile,
} from "./control-attachments";

type Props = {
  workspaces: Workspace[];
  onCancel?: () => void;
  onCreate: (
    text: string,
    targets: string[],
    options: ComposerSendOptions
  ) => void;
};

export function NewMissionComposer({ workspaces, onCancel, onCreate }: Props) {
  const [text, setText] = useState("");
  const [targets, setTargets] = useState<string[]>(
    workspaces[0]?.id ? [workspaces[0].id] : []
  );
  const [permissionsIdx, setPermissionsIdx] = useState(0); // Default: Skip Permissions
  const [files, setFiles] = useState<ControlComposerFile[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { modelIds, defaultModelId } = useModels();
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  // The user's pick wins; until then follow the account default, same as
  // the conversation composer.
  const modelId = selectedModel ?? defaultModelId ?? modelIds[0] ?? null;

  const activeWorkspaces = workspaces.filter((w) => w.status === "active");
  const availableToAdd = activeWorkspaces.filter(
    (w) => !targets.includes(w.id)
  );

  const cyclePermissions = useCallback(() => {
    setPermissionsIdx((i) => (i + 1) % MISSION_PERMISSION_OPTIONS.length);
  }, []);

  const addTarget = useCallback(() => {
    if (availableToAdd.length > 0) {
      setTargets((prev) => [...prev, availableToAdd[0].id]);
    }
  }, [availableToAdd]);

  const removeTarget = useCallback((id: string) => {
    setTargets((prev) => prev.filter((t) => t !== id));
  }, []);

  const handleSubmit = useCallback(() => {
    if (text.trim() || files.length > 0) {
      onCreate(text.trim(), targets, {
        model: modelId,
        permissions: MISSION_PERMISSION_OPTIONS[permissionsIdx],
        mode: "run",
        files,
      });
      setText("");
      setFiles([]);
    }
  }, [text, targets, files, modelId, permissionsIdx, onCreate]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (
        e.key === "Enter" &&
        !e.shiftKey &&
        (text.trim() || files.length > 0)
      ) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [text, files.length, handleSubmit]
  );

  return (
    <div className="flex flex-1 flex-col justify-end px-4 py-5 sm:px-8">
      <div className="mx-auto flex w-full max-w-[760px] flex-1 flex-col justify-center">
        {/* Header */}
        <div className="mb-8">
          <MogplexFace
            className="text-foreground mb-3 size-9"
            aria-hidden="true"
          />
          <h2 className="text-[20px] leading-7 font-semibold">
            Describe the outcome
          </h2>
          <p className="text-secondary-foreground mt-1 text-sm leading-6">
            Mogplex plans it, starts the sandbox, and streams the run state
            here.
          </p>
        </div>

        {activeWorkspaces.length > 0 || targets.length > 0 ? (
          <div className="mb-4 space-y-2">
            <div className="text-muted-foreground flex items-center gap-2 text-xs">
              <span>
                {targets.length} workspace{targets.length !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {targets.map((t) => {
                const ws = workspaces.find((w) => w.id === t);
                return (
                  <div
                    key={t}
                    className="border-border bg-secondary flex items-center gap-1.5 rounded-md border px-3 py-1.5"
                  >
                    <span className="bg-primary size-1.5 rounded-full" />
                    <span className="text-xs font-medium">{ws?.name || t}</span>
                    {targets.length > 1 && (
                      <button
                        onClick={() => removeTarget(t)}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <Xmark className="size-3" />
                      </button>
                    )}
                  </div>
                );
              })}
              {availableToAdd.length > 0 && (
                <button
                  onClick={addTarget}
                  className="border-border text-muted-foreground hover:border-primary hover:text-foreground flex items-center gap-1 rounded-md border border-dashed px-3 py-1.5 text-xs"
                >
                  <Plus className="size-3" />
                  Add workspace
                </button>
              )}
            </div>
          </div>
        ) : null}

        {/* Input */}
        <div className="border-border-dim bg-card rounded-xl border p-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything or run a command..."
            rows={4}
            className="placeholder:text-muted-foreground max-h-60 min-h-24 w-full resize-none bg-transparent px-1 text-sm leading-6 outline-none"
            autoFocus
          />

          {/* Options row */}
          <div className="border-border mt-2 flex flex-wrap items-center gap-2 border-t pt-3">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="text-muted-foreground hover:bg-muted hover:text-foreground grid size-8 place-items-center rounded-md"
              aria-label="Attach file"
            >
              <Attachment className="size-4" strokeWidth={1.6} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="sr-only"
              onChange={async (event) => {
                const selectedFiles = Array.from(
                  event.currentTarget.files ?? []
                );
                const result = await readControlComposerFiles(
                  selectedFiles,
                  files.length
                );
                if (result.attachments.length > 0) {
                  setFiles((current) => [...current, ...result.attachments]);
                }
                setAttachmentError(result.error);
                event.currentTarget.value = "";
              }}
            />
            <button
              onClick={cyclePermissions}
              className={`flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium ${
                MISSION_PERMISSION_OPTIONS[permissionsIdx] ===
                "Skip Permissions"
                  ? "border-accent-amber/30 bg-accent-amber/10 text-accent-amber hover:bg-accent-amber/20"
                  : "border-accent-blue/30 bg-accent-blue/10 text-accent-blue hover:bg-accent-blue/20"
              }`}
            >
              {MISSION_PERMISSION_OPTIONS[permissionsIdx] ===
              "Skip Permissions" ? (
                <ShieldXmark className="size-3.5" strokeWidth={1.6} />
              ) : (
                <ShieldCheck className="size-3.5" strokeWidth={1.6} />
              )}
              {MISSION_PERMISSION_OPTIONS[permissionsIdx]}
            </button>
            <ModelChip
              modelId={modelId}
              modelIds={modelIds}
              onSelect={setSelectedModel}
              disabled={false}
            />

            <div className="ml-auto flex items-center gap-2">
              {onCancel ? (
                <button
                  onClick={onCancel}
                  className="border-border hover:bg-secondary h-8 rounded-md border px-3 text-xs font-medium"
                >
                  Cancel
                </button>
              ) : null}
              <button
                onClick={handleSubmit}
                disabled={!text.trim() && files.length === 0}
                className={`flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors ${
                  text.trim() || files.length > 0
                    ? "bg-primary text-primary-foreground hover:bg-brand-accent-hover"
                    : "bg-muted text-muted-foreground cursor-not-allowed"
                }`}
              >
                <SendDiagonal className="size-3.5" strokeWidth={1.8} />
                Start mission
              </button>
            </div>
          </div>
          {files.length > 0 && (
            <div className="border-border mt-2 flex flex-wrap gap-1.5 border-t pt-2">
              {files.map((file) => (
                <span
                  key={file.id}
                  className="border-border bg-secondary text-secondary-foreground inline-flex max-w-48 items-center gap-1 rounded border px-2 py-1 text-[10px]"
                >
                  <Attachment className="size-3 shrink-0" strokeWidth={1.6} />
                  <span className="truncate">
                    {file.filename ?? file.mediaType}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${file.filename ?? "attachment"}`}
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() =>
                      setFiles((current) =>
                        current.filter((item) => item !== file)
                      )
                    }
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          {attachmentError ? (
            <p className="text-accent-red mt-2 text-[11px]">
              {attachmentError}
            </p>
          ) : null}
        </div>

        {/* Hint */}
        <p className="text-muted-foreground mt-3 text-center text-[11px]">
          Enter to submit · Shift+Enter for a new line · ⌘K opens search
        </p>
      </div>
    </div>
  );
}

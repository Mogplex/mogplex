"use client";
import { useState, useCallback, useRef } from "react";
import {
  ArrowUp,
  Attachment,
  Square,
  ShieldCheck,
  ShieldXmark,
} from "iconoir-react";
import { McpStatusButton } from "@/components/chat/mcp-status-button";
import { CHIP_CLASS, ModelChip } from "./model-chip";
import { ControlPermissionsNote } from "./permissions-note";
import { useModels } from "@/hooks/use-models";
import { ControlErrorBanner } from "./control-load-state";
import type { ControlContextUsage } from "@/lib/control/context-usage";
import { MISSION_PERMISSION_OPTIONS } from "@/lib/control/types";
import type { MissionPermissions } from "@/lib/control/types";
import {
  appendControlComposerFiles,
  consumeControlFileInput,
  type ControlComposerFile,
} from "./control-attachments";
import { useControlFileDrop } from "./use-control-file-drop";
import { useSkillSuggestionMenu } from "./skill-suggestions";
export type ComposerSendOptions = {
  model: string | null;
  permissions: MissionPermissions;
  mode: "plan" | "run";
  files: ControlComposerFile[];
};
type Props = {
  value: string;
  onChange: (value: string) => void;
  onSend: (
    text: string,
    target: string,
    scope: string,
    options: ComposerSendOptions
  ) => Promise<boolean>;
  pending: boolean;
  archiving?: boolean;
  onStop: () => void;
  initialModelId: string | null;
  onModelSelect: (modelId: string) => Promise<boolean>;
  /** Provider measurement for the latest model step, not cumulative billing. */
  contextUsage?: ControlContextUsage | null;
  /** Narrows skill completion to the open repo's catalog. */
  repoId?: string | null;
};

/** Circular context gauge: percent of the model's context window used. */
function ContextRing({
  usageTokens,
  contextLimit,
}: {
  usageTokens: number | null;
  contextLimit: number | undefined;
}) {
  const percent = contextLimit && usageTokens !== null
    ? Math.min(100, Math.round((usageTokens / contextLimit) * 100))
    : null;
  const circumference = 2 * Math.PI * 15.5;
  const offset =
    percent === null ? circumference : circumference * (1 - Math.max(percent, 2) / 100);
  const title = contextLimit && usageTokens !== null
    ? `Last model step: ${percent}% (${usageTokens.toLocaleString()} / ${contextLimit.toLocaleString()} tokens). Session spending is separate.`
    : "Context usage is not measured yet for this model. Session token totals are not context usage.";

  return (
    <div className="relative size-9 shrink-0" title={title} aria-label="Context usage">
      <svg viewBox="0 0 36 36" className="size-9 -rotate-90">
        <circle
          cx="18"
          cy="18"
          r="15.5"
          fill="none"
          stroke="var(--ink-700)"
          strokeWidth="3"
        />
        <circle
          cx="18"
          cy="18"
          r="15.5"
          fill="none"
          stroke={percent !== null && percent >= 90 ? "var(--delr)" : "var(--ink-400)"}
          strokeWidth="3"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-ink-300">
        {percent !== null ? percent : "?"}
      </span>
    </div>
  );
}

export function Composer({
  value,
  onChange,
  onSend,
  pending,
  archiving = false,
  onStop,
  initialModelId,
  onModelSelect,
  contextUsage = null,
  repoId,
}: Props) {
  const [permissionsIdx, setPermissionsIdx] = useState(0); // Default: Skip Permissions
  const [files, setFiles] = useState<ControlComposerFile[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const { modelIds, defaultModelId, contextLimits, isLoading: modelsLoading, error: modelsError, mutate: mutateModels } = useModels("control");
  const [selectedModel, setSelectedModel] = useState<string | null>(
    initialModelId
  );
  const [modelSaving, setModelSaving] = useState(false);
  // The user's pick wins; until then follow their account default so the chip
  // never shows a model the send path wouldn't actually use.
  const modelId = selectedModel ?? defaultModelId ?? modelIds[0] ?? null;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const {
    isDraggingFiles,
    addFiles,
    dropZoneProps,
  } = useControlFileDrop({
    disabled: pending || archiving,
    existingCount: files.length,
    onAttachments: useCallback(
      (attachments: ControlComposerFile[]) =>
        setFiles((current) =>
          appendControlComposerFiles(current, attachments)
        ),
      []
    ),
    onError: setAttachmentError,
  });

  const cyclePermissions = useCallback(() => {
    setPermissionsIdx((i) => (i + 1) % MISSION_PERMISSION_OPTIONS.length);
  }, []);

  const selectModel = useCallback(
    async (nextModelId: string) => {
      const previousModel = selectedModel;
      setSelectedModel(nextModelId);
      setModelSaving(true);
      let saved = false;
      try {
        saved = await onModelSelect(nextModelId);
      } catch {
        saved = false;
      } finally {
        setModelSaving(false);
      }
      if (!saved) {
        setSelectedModel((current) =>
          current === nextModelId ? previousModel : current
        );
      }
    },
    [onModelSelect, selectedModel]
  );

  const handleSend = useCallback(async () => {
    if ((value.trim() || files.length > 0) && !pending && !archiving && !modelSaving && !modelsLoading && modelId) {
      const draft = { text: value, files: [...files] };
      onChange("");
      setFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = "";

      let sent = false;
      try {
        sent = await onSend(value.trim(), "mission", "IMPLEMENT", {
          model: modelId,
          permissions: MISSION_PERMISSION_OPTIONS[permissionsIdx],
          mode: "run",
          files,
        });
      } catch (error) {
        console.error("[control] send rejected, restoring composer draft", error);
        // A caller that rejects instead of returning false still preserves the
        // user's draft, matching the request-failure recovery path below.
      }
      if (!sent) {
        onChange(draft.text);
        setFiles(draft.files);
      }
    }
  }, [
    value,
    files,
    pending,
    archiving,
    modelSaving,
    modelsLoading,
    modelId,
    permissionsIdx,
    onSend,
    onChange,
  ]);

  const skillMenu = useSkillSuggestionMenu({ value, onChange, repoId });
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (skillMenu.handleKeyDown(e)) return;
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend, skillMenu]
  );

  const skipPermissions =
    MISSION_PERMISSION_OPTIONS[permissionsIdx] === "Skip Permissions";

  return (
    <fieldset disabled={archiving} className="mx-auto min-w-0 w-full max-w-[67rem] shrink-0 px-4 pb-5 sm:px-6">
      <ControlErrorBanner message={modelsError ? "We could not load models. Try again." : null} onRetry={() => { void mutateModels().catch(() => undefined); }} />
      {archiving ? <p role="status" className="pb-2 text-xs text-ink-400">Archive in progress</p> : null}
      <div
        data-testid="control-composer-dropzone"
        {...dropZoneProps}
        className={`relative overflow-hidden rounded-xl border bg-ink-900 transition-colors ${
          isDraggingFiles
            ? "border-accent-blue bg-accent-blue/5"
            : "border-ink-800"
        }`}
      >
        {isDraggingFiles ? (
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 bg-accent-blue px-3 py-1 text-center text-[11px] font-medium text-primary-foreground">
            Drop images or files to attach
          </div>
        ) : null}
        {skillMenu.element}
        <label htmlFor="control-composer" className="sr-only">
          Ask for follow-up changes
        </label>
        <textarea
          id="control-composer"
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask for follow-up changes or attach images"
          rows={2}
          className="max-h-60 w-full resize-none bg-transparent px-5 pt-4 pb-2 text-[15px] text-ink-100 outline-none [field-sizing:content] placeholder:text-ink-400"
          disabled={pending}
        />

        {files.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-4 pb-2">
            {files.map((file) => (
              <span
                key={file.id}
                className="inline-flex max-w-48 items-center gap-1 rounded border border-ink-700 bg-ink-800 px-2 py-1 text-[10px] text-ink-300"
              >
                <Attachment className="size-3 shrink-0" strokeWidth={1.6} />
                <span className="truncate">
                  {file.filename ?? file.mediaType}
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${file.filename ?? "attachment"}`}
                  className="text-ink-400 hover:text-ink-100"
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
          <p className="px-4 pb-1 text-[11px] text-delr">{attachmentError}</p>
        ) : null}

        <div className="flex flex-wrap items-center gap-1 px-3 pb-3">
          <button
            type="button"
            disabled={pending}
            aria-label="Attach file"
            title="Attach file"
            onClick={() => fileInputRef.current?.click()}
            className={CHIP_CLASS}
          >
            <Attachment className="size-4" strokeWidth={1.6} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            className="sr-only"
            multiple
            onChange={async (event) => {
              const selectedFiles = consumeControlFileInput(
                event.currentTarget
              );
              await addFiles(selectedFiles);
            }}
          />
          <ModelChip
            loading={modelsLoading}
            modelId={modelId}
            modelIds={modelIds}
            onSelect={(nextModelId) => void selectModel(nextModelId)}
            disabled={pending || modelSaving}
          />
          <button
            type="button"
            onClick={cyclePermissions}
            title="Tool permissions"
            aria-describedby={skipPermissions ? undefined : "control-permissions-note"}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors ${
              skipPermissions
                ? "bg-accent-amber/10 text-accent-amber hover:bg-accent-amber/20"
                : "bg-accent-blue/10 text-accent-blue hover:bg-accent-blue/20"
            }`}
          >
            {skipPermissions ? (
              <ShieldXmark className="size-3.5" strokeWidth={1.6} />
            ) : (
              <ShieldCheck className="size-3.5" strokeWidth={1.6} />
            )}
            {MISSION_PERMISSION_OPTIONS[permissionsIdx]}
          </button>
          <span className="text-[12px] text-ink-400">
            <McpStatusButton />
          </span>
          <div className="ml-auto flex items-center gap-3">
            <ContextRing
              usageTokens={contextUsage?.model === modelId ? contextUsage.inputTokens + contextUsage.outputTokens : null}
              contextLimit={modelId ? contextLimits[modelId] : undefined}
            />
            {pending ? (
              <button
                type="button"
                aria-label="Stop"
                onClick={onStop}
                title="Stop the current response"
                className="flex h-9 items-center justify-center gap-2 rounded-md border border-border bg-muted px-3 text-sm text-foreground hover:bg-accent"
              >
                <Square className="size-3 fill-current" />
                Stop
              </button>
            ) : (
              <button
                type="button"
                aria-label="Send"
                onClick={() => void handleSend()}
                disabled={
                  modelSaving || modelsLoading || !modelId || (!value.trim() && files.length === 0)
                }
                className={`flex size-9 items-center justify-center rounded-full transition-colors ${
                  !modelSaving && !modelsLoading && modelId && (value.trim() || files.length > 0)
                    ? "bg-primary text-primary-foreground hover:bg-brand-accent-hover"
                    : "cursor-not-allowed bg-ink-800 text-ink-600"
                }`}
              >
                <ArrowUp className="size-4" strokeWidth={2.4} />
              </button>
            )}
          </div>
        </div>
        <ControlPermissionsNote permissions={MISSION_PERMISSION_OPTIONS[permissionsIdx]} />
      </div>
    </fieldset>
  );
}

"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  ArrowUp,
  Attachment,
  NavArrowDown,
  PauseSolid,
  ShieldCheck,
  ShieldXmark,
} from "iconoir-react";
import { McpStatusButton } from "@/components/chat/mcp-status-button";
import { ProviderIcon } from "@/components/provider-icon";
import { useModels } from "@/hooks/use-models";
import { MISSION_PERMISSION_OPTIONS } from "@/lib/control/types";
import type { MissionPermissions } from "@/lib/control/types";
import {
  appendControlComposerFiles,
  consumeControlFileInput,
  type ControlComposerFile,
} from "./control-attachments";
import { useControlFileDrop } from "./use-control-file-drop";

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
  onStop: () => void;
  initialModelId: string | null;
  onModelSelect: (modelId: string) => Promise<boolean>;
  /** Total tokens consumed by the active session (drives the context ring). */
  usageTokens?: number;
};

const CHIP_CLASS =
  "flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-[13px] text-ink-300 transition-colors hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-50";

function shortModelName(modelId: string) {
  return modelId.split("/").pop() ?? modelId;
}

function modelProvider(modelId: string) {
  return modelId.split("/")[0] ?? modelId;
}

function compactTokens(tokens: number) {
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return String(tokens);
}

/** Circular context gauge: percent of the model's context window used. */
function ContextRing({
  usageTokens,
  contextLimit,
}: {
  usageTokens: number;
  contextLimit: number | undefined;
}) {
  const percent = contextLimit
    ? Math.min(100, Math.round((usageTokens / contextLimit) * 100))
    : null;
  const circumference = 2 * Math.PI * 15.5;
  const offset =
    percent === null ? 0 : circumference * (1 - Math.max(percent, 2) / 100);
  const title = contextLimit
    ? `Context: ${percent}% used (${usageTokens.toLocaleString()} / ${contextLimit.toLocaleString()} tokens)`
    : `Tokens used this session: ${usageTokens.toLocaleString()} (context window unknown)`;

  return (
    <div className="relative size-9 shrink-0" title={title}>
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
        {percent !== null ? percent : compactTokens(usageTokens)}
      </span>
    </div>
  );
}

export function ModelChip({
  modelId,
  modelIds,
  onSelect,
  disabled,
}: {
  modelId: string | null;
  modelIds: string[];
  onSelect: (modelId: string) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [menuPos, setMenuPos] = useState<{
    left: number;
    bottom: number;
  } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (btnRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const filtered = modelIds.filter(
    (m) => !filter || m.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="relative">
      <button
        ref={btnRef}
        disabled={disabled}
        onClick={() => {
          setOpen((o) => {
            if (!o && btnRef.current) {
              const rect = btnRef.current.getBoundingClientRect();
              setMenuPos({
                left: rect.left,
                bottom: window.innerHeight - rect.top + 4,
              });
            }
            return !o;
          });
          setFilter("");
        }}
        className={`${CHIP_CLASS} font-medium text-ink-200`}
      >
        {modelId ? (
          <ProviderIcon
            provider={modelProvider(modelId)}
            className="size-4 border-0"
          />
        ) : null}
        {modelId ? shortModelName(modelId) : "Model"}
        <NavArrowDown className="size-3 text-ink-400" strokeWidth={2} />
      </button>
      {open &&
        menuPos &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed z-[9999] flex max-h-56 w-72 flex-col rounded-lg border border-ink-700 bg-ink-850 shadow-2xl shadow-black/50"
            style={{ left: menuPos.left, bottom: menuPos.bottom }}
          >
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search models..."
              className="border-b border-ink-700 bg-ink-900 px-2 py-1.5 text-[11px] text-ink-100 outline-none"
              autoFocus
            />
            <div className="flex-1 overflow-auto">
              {filtered.length === 0 && (
                <div className="px-2 py-1.5 text-[11px] text-ink-400">
                  No models
                </div>
              )}
              {filtered.map((m) => (
                <button
                  key={m}
                  onClick={() => {
                    onSelect(m);
                    setOpen(false);
                    setFilter("");
                  }}
                  className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-[11px] hover:bg-ink-800 ${
                    m === modelId ? "text-ink-100" : "text-ink-300"
                  }`}
                >
                  <ProviderIcon
                    provider={modelProvider(m)}
                    className="size-4 border-0"
                  />
                  <span className="truncate">{m}</span>
                </button>
              ))}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

export function Composer({
  value,
  onChange,
  onSend,
  pending,
  onStop,
  initialModelId,
  onModelSelect,
  usageTokens = 0,
}: Props) {
  const [permissionsIdx, setPermissionsIdx] = useState(0); // Default: Skip Permissions
  const [files, setFiles] = useState<ControlComposerFile[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const { modelIds, defaultModelId, contextLimits } = useModels();
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
    disabled: pending,
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
    if ((value.trim() || files.length > 0) && !pending && !modelSaving) {
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
    modelSaving,
    modelId,
    permissionsIdx,
    onSend,
    onChange,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend]
  );

  const skipPermissions =
    MISSION_PERMISSION_OPTIONS[permissionsIdx] === "Skip Permissions";

  return (
    <div className="mx-auto w-full max-w-[67rem] shrink-0 px-4 pb-5 sm:px-6">
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
            modelId={modelId}
            modelIds={modelIds}
            onSelect={(nextModelId) => void selectModel(nextModelId)}
            disabled={pending || modelSaving}
          />
          <button
            type="button"
            onClick={cyclePermissions}
            title="Tool permissions"
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
              usageTokens={usageTokens}
              contextLimit={modelId ? contextLimits[modelId] : undefined}
            />
            {pending ? (
              <button
                type="button"
                aria-label="Stop"
                onClick={onStop}
                className="flex size-9 items-center justify-center rounded-full bg-accent-red text-primary-foreground transition-colors hover:bg-accent-red/90"
              >
                <PauseSolid className="size-4" />
              </button>
            ) : (
              <button
                type="button"
                aria-label="Send"
                onClick={() => void handleSend()}
                disabled={
                  modelSaving || (!value.trim() && files.length === 0)
                }
                className={`flex size-9 items-center justify-center rounded-full transition-colors ${
                  !modelSaving && (value.trim() || files.length > 0)
                    ? "bg-primary text-primary-foreground hover:bg-brand-accent-hover"
                    : "cursor-not-allowed bg-ink-800 text-ink-600"
                }`}
              >
                <ArrowUp className="size-4" strokeWidth={2.4} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

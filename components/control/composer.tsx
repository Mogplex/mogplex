"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  Attachment,
  NavArrowDown,
  PauseSolid,
  SendDiagonal,
  ShieldCheck,
  ShieldXmark,
} from "iconoir-react";
import { McpStatusButton } from "@/components/chat/mcp-status-button";
import { ProviderIcon } from "@/components/provider-icon";
import { useModels } from "@/hooks/use-models";
import { MISSION_PERMISSION_OPTIONS } from "@/lib/control/types";
import type {
  Mission,
  MissionPermissions,
  Worktree,
} from "@/lib/control/types";
import {
  readControlComposerFiles,
  type ControlComposerFile,
} from "./control-attachments";

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
  ) => void;
  pending: boolean;
  mission: Mission | undefined;
  worktrees: Worktree[];
  onStop: () => void;
};

type Scope = "plan" | "implement" | "test" | "pipeline";

const SCOPE_LABELS: Record<Scope, string> = {
  plan: "PLAN ONLY",
  implement: "IMPLEMENT",
  test: "IMPLEMENT + TEST",
  pipeline: "FULL PIPELINE",
};

const SCOPES: Scope[] = ["plan", "implement", "test", "pipeline"];

function shortModelName(modelId: string) {
  return modelId.split("/").pop() ?? modelId;
}

function modelProvider(modelId: string) {
  return modelId.split("/")[0] ?? modelId;
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
        className="border-border bg-card text-accent-blue hover:bg-secondary flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
      >
        {modelId ? (
          <ProviderIcon
            provider={modelProvider(modelId)}
            className="size-4 border-0"
          />
        ) : null}
        {modelId ? shortModelName(modelId) : "Model"}
        <NavArrowDown className="size-3 opacity-70" strokeWidth={2} />
      </button>
      {open &&
        menuPos &&
        createPortal(
          <div
            ref={menuRef}
            className="border-border bg-card fixed z-[9999] flex max-h-56 w-72 flex-col rounded-lg border shadow-lg"
            style={{ left: menuPos.left, bottom: menuPos.bottom }}
          >
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search models..."
              className="border-border bg-input text-foreground border-b px-2 py-1.5 text-[11px] outline-none"
              autoFocus
            />
            <div className="flex-1 overflow-auto">
              {filtered.length === 0 && (
                <div className="text-muted-foreground px-2 py-1.5 text-[11px]">
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
                  className={`hover:bg-secondary/50 flex w-full items-center gap-2 px-2 py-1.5 text-left text-[11px] ${
                    m === modelId
                      ? "bg-accent-blue/5 text-accent-blue"
                      : "text-foreground"
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
  mission: _mission,
  worktrees,
  onStop,
}: Props) {
  const [target, setTarget] = useState("mission");
  const [scope, setScope] = useState<Scope>("implement");
  const [permissionsIdx, setPermissionsIdx] = useState(0); // Default: Skip Permissions
  const [files, setFiles] = useState<ControlComposerFile[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const { modelIds, defaultModelId } = useModels();
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  // The user's pick wins; until then follow their account default so the chip
  // never shows a model the send path wouldn't actually use.
  const modelId = selectedModel ?? defaultModelId ?? modelIds[0] ?? null;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const targets = useMemo(
    () => [
      "mission",
      ...worktrees.filter((w) => w.state !== "archived").map((w) => w.id),
    ],
    [worktrees]
  );

  const quickPrompts = useMemo(() => {
    const active = worktrees.filter((w) => w.state !== "archived");
    const prompts = [
      {
        label: "Try another approach",
        value: "Fork a new worktree and try a different approach.",
      },
    ];
    if (active.length >= 2) {
      prompts.unshift({
        label: `Compare ${active[0].id} and ${active[1].id}`,
        value: `Compare the implementations in ${active[0].id} and ${active[1].id}.`,
      });
    }
    const blocked = worktrees.find((w) => w.state === "blocked");
    if (blocked) {
      prompts.push({
        label: "Explain the conflict",
        value: `Explain the ${blocked.id} conflict and how to resolve it.`,
      });
    }
    return prompts;
  }, [worktrees]);

  const cycleTarget = useCallback(() => {
    const idx = targets.indexOf(target);
    setTarget(targets[(idx + 1) % targets.length]);
  }, [targets, target]);

  const cycleScope = useCallback(() => {
    const idx = SCOPES.indexOf(scope);
    setScope(SCOPES[(idx + 1) % SCOPES.length]);
  }, [scope]);

  const cyclePermissions = useCallback(() => {
    setPermissionsIdx((i) => (i + 1) % MISSION_PERMISSION_OPTIONS.length);
  }, []);

  const handleSend = useCallback(() => {
    if ((value.trim() || files.length > 0) && !pending) {
      onSend(value.trim(), target, SCOPE_LABELS[scope], {
        model: modelId,
        permissions: MISSION_PERMISSION_OPTIONS[permissionsIdx],
        mode: "run",
        files,
      });
      onChange("");
      setFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [
    value,
    files,
    pending,
    target,
    scope,
    modelId,
    permissionsIdx,
    onSend,
    onChange,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  return (
    <div className="bg-transparent px-4 pb-5 sm:px-6">
      <div className="border-border-dim bg-card mx-auto max-w-[760px] rounded-xl border p-3">
        {/* Quick prompts row */}
        <div className="border-border flex flex-wrap gap-1.5 border-b pb-2">
          {quickPrompts.map((prompt) => (
            <button
              key={prompt.label}
              onClick={() => {
                onChange(prompt.value);
                textareaRef.current?.focus();
              }}
              className="border-border text-muted-foreground hover:bg-secondary hover:text-foreground rounded border px-2 py-1 text-[10px] font-medium"
            >
              {prompt.label}
            </button>
          ))}
        </div>

        {/* Main input area */}
        <div className="flex items-end gap-2 pt-3">
          <div className="flex flex-1 flex-col gap-2">
            {/* Chips row */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={pending}
                aria-label="Attach file"
                title="Attach file"
                onClick={() => fileInputRef.current?.click()}
                className="text-muted-foreground hover:bg-secondary hover:text-foreground grid size-8 place-items-center rounded-md disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Attachment className="size-4" strokeWidth={1.6} />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                className="sr-only"
                multiple
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
                onClick={cycleTarget}
                className="border-border bg-card hover:bg-secondary flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium"
              >
                <span
                  className={`size-1.5 rounded-full ${target === "mission" ? "bg-primary" : "bg-accent-blue"}`}
                />
                {target === "mission" ? "MISSION" : target.toUpperCase()}
              </button>
              <button
                onClick={cycleScope}
                disabled={pending}
                className="border-border bg-card hover:bg-secondary h-8 rounded-md border px-2.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
              >
                {SCOPE_LABELS[scope]}
              </button>
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
                disabled={pending}
              />
              <span className="text-muted-foreground ml-auto text-[12px]">
                <McpStatusButton />
              </span>
            </div>

            {/* Textarea */}
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                target === "mission"
                  ? "Direct Mogplex - it will delegate to agents"
                  : `Steer ${target} directly`
              }
              rows={1}
              className="placeholder:text-muted-foreground [field-sizing:content] max-h-60 min-h-12 flex-1 resize-y bg-transparent text-sm leading-6 outline-none"
              disabled={pending}
            />

            {files.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
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
              <p className="text-accent-red text-[11px]">{attachmentError}</p>
            ) : null}

            {/* Hint */}
            <span className="text-muted-foreground text-[10px]">
              Enter to send · Shift+Enter for a new line
            </span>
          </div>

          {/* Send/Stop button */}
          {pending ? (
            <button
              aria-label="Stop"
              onClick={onStop}
              className="bg-accent-red hover:bg-accent-red/90 flex size-8 items-center justify-center rounded-md text-primary-foreground"
            >
              <PauseSolid className="size-4" />
            </button>
          ) : (
            <button
              aria-label="Send"
              onClick={handleSend}
              disabled={!value.trim() && files.length === 0}
              className={`flex size-8 items-center justify-center rounded-md transition-colors ${
                value.trim() || files.length > 0
                  ? "bg-primary text-primary-foreground hover:bg-brand-accent-hover"
                  : "bg-muted text-muted-foreground cursor-not-allowed"
              }`}
            >
              <SendDiagonal className="size-4" strokeWidth={1.8} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

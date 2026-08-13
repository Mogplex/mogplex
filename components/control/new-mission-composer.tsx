"use client";

import { useState, useCallback, useRef } from "react";
import {
  Attachment,
  SendDiagonal,
  ShieldCheck,
  ShieldXmark,
} from "iconoir-react";
import { MogplexFace } from "@/components/brand/mogplex-face";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useModels } from "@/hooks/use-models";
import { MISSION_PERMISSION_OPTIONS } from "@/lib/control/types";
import type { Repo } from "@/lib/types";
import {
  defaultProjectChoice,
  deriveProjectName,
  repoProjectName,
} from "@/lib/control/session-project";
import { ModelChip, type ComposerSendOptions } from "./composer";
import {
  type ControlComposerFile,
} from "./control-attachments";
import { useControlFileDrop } from "./use-control-file-drop";

const NEW_PROJECT = "new";

type Props = {
  repos: Repo[];
  onCancel?: () => void;
  onCreate: (
    text: string,
    project: string,
    repoId: string | null,
    options: ComposerSendOptions
  ) => void;
};

export function NewMissionComposer({ repos, onCancel, onCreate }: Props) {
  const [text, setText] = useState("");
  // null = untouched: follow the default (favorite/first repo, or "new" when
  // no repos are connected). Repos load async, so the default resolves late.
  const [choice, setChoice] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState("");
  const [permissionsIdx, setPermissionsIdx] = useState(0); // Default: Skip Permissions
  const [files, setFiles] = useState<ControlComposerFile[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { modelIds, defaultModelId } = useModels();
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const {
    isDraggingFiles,
    addFiles,
    dropZoneProps,
  } = useControlFileDrop({
    existingCount: files.length,
    onAttachments: useCallback(
      (attachments: ControlComposerFile[]) =>
        setFiles((current) => [...current, ...attachments]),
      []
    ),
    onError: setAttachmentError,
  });
  // The user's pick wins; until then follow the account default, same as
  // the conversation composer.
  const modelId = selectedModel ?? defaultModelId ?? modelIds[0] ?? null;

  const selectedRepoId = choice ?? defaultProjectChoice(repos);

  const cyclePermissions = useCallback(() => {
    setPermissionsIdx((i) => (i + 1) % MISSION_PERMISSION_OPTIONS.length);
  }, []);

  const handleSubmit = useCallback(() => {
    if (!text.trim() && files.length === 0) return;
    // Every session is tied to a project: the selected repo, or a new project
    // named explicitly (falling back to a slug derived from the mission).
    const repo = repos.find((r) => r.id === selectedRepoId);
    const project = repo
      ? repoProjectName(repo)
      : newProjectName.trim() || deriveProjectName(text);
    onCreate(text.trim(), project, repo?.id ?? null, {
      model: modelId,
      permissions: MISSION_PERMISSION_OPTIONS[permissionsIdx],
      mode: "run",
      files,
    });
    setText("");
    setFiles([]);
  }, [
    text,
    files,
    repos,
    selectedRepoId,
    newProjectName,
    modelId,
    permissionsIdx,
    onCreate,
  ]);

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

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <label
            htmlFor="control-project"
            className="text-muted-foreground text-xs"
          >
            Project
          </label>
          <Select
            value={selectedRepoId}
            onValueChange={setChoice}
          >
            <SelectTrigger
              id="control-project"
              aria-label="Project"
              className="border-border bg-secondary text-secondary-foreground h-8 w-64 max-w-full px-2 text-xs font-medium shadow-none"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-border bg-popover max-h-72 shadow-2xl">
              {repos.map((repo) => (
                <SelectItem key={repo.id} value={repo.id}>
                  {repo.full_name}
                </SelectItem>
              ))}
              <SelectItem value={NEW_PROJECT}>New project…</SelectItem>
            </SelectContent>
          </Select>
          {selectedRepoId === NEW_PROJECT ? (
            <input
              value={newProjectName}
              onChange={(event) => setNewProjectName(event.target.value)}
              placeholder={deriveProjectName(text)}
              aria-label="New project name"
              className="border-border bg-secondary text-secondary-foreground placeholder:text-muted-foreground h-8 w-48 rounded-md border px-2 text-xs outline-none"
            />
          ) : null}
        </div>

        {/* Input */}
        <div
          data-testid="control-new-mission-dropzone"
          {...dropZoneProps}
          className={`relative rounded-xl border p-3 transition-colors ${
            isDraggingFiles
              ? "border-accent-blue bg-accent-blue/5"
              : "border-border-dim bg-card"
          }`}
        >
          {isDraggingFiles ? (
            <div className="pointer-events-none absolute inset-x-0 top-0 bg-accent-blue px-3 py-1 text-center text-[11px] font-medium text-primary-foreground">
              Drop images or files to attach
            </div>
          ) : null}
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
                await addFiles(selectedFiles);
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

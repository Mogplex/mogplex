"use client";

import { useState, useCallback, useRef } from "react";
import {
  Attachment,
  SendDiagonal,
  ShieldCheck,
  ShieldXmark,
} from "iconoir-react";
import { MogplexFace } from "@/components/brand/mogplex-face";
import { useModels } from "@/hooks/use-models";
import { fetchWithActiveTeam } from "@/components/active-scope-provider";
import { MISSION_PERMISSION_OPTIONS } from "@/lib/control/types";
import type { Repo } from "@/lib/types";
import {
  defaultProjectChoice,
  deriveProjectName,
  repoProjectName,
} from "@/lib/control/session-project";
import { ModelChip, type ComposerSendOptions } from "./composer";
import {
  appendControlComposerFiles,
  consumeControlFileInput,
  type ControlComposerFile,
} from "./control-attachments";
import { useControlFileDrop } from "./use-control-file-drop";
import { NewProjectFields, NewProjectStatus } from "./new-project-fields";
import { ProjectCombobox } from "./project-combobox";
import {
  LAST_GITHUB_OWNER_KEY,
  useNewProjectTarget,
} from "./use-new-project-target";

const NEW_PROJECT = "new";
/** Availability states that permit creating the project. */
const CREATABLE_AVAILABILITY = new Set(["available", "unverified"]);

type Props = {
  repos: Repo[];
  initialRepoId?: string | null;
  onCancel?: () => void;
  onCreate: (
    text: string,
    project: string,
    repoId: string | null,
    options: ComposerSendOptions,
    createdRepo?: Repo
  ) => Promise<boolean>;
};

export function NewMissionComposer({
  repos,
  initialRepoId,
  onCancel,
  onCreate,
}: Props) {
  const [text, setText] = useState("");
  // null = untouched: follow the default (favorite/first repo, or "new" when
  // no repos are connected). Repos load async, so the default resolves late.
  const [choice, setChoice] = useState<string | null>(initialRepoId ?? null);
  const [newProjectName, setNewProjectName] = useState("");
  const [projectError, setProjectError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [permissionsIdx, setPermissionsIdx] = useState(0); // Default: Skip Permissions
  const [files, setFiles] = useState<ControlComposerFile[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { modelIds, defaultModelId } = useModels();
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const { isDraggingFiles, addFiles, dropZoneProps } = useControlFileDrop({
    existingCount: files.length,
    onAttachments: useCallback(
      (attachments: ControlComposerFile[]) =>
        setFiles((current) => appendControlComposerFiles(current, attachments)),
      []
    ),
    onError: setAttachmentError,
  });
  // The user's pick wins; until then follow the account default, same as
  // the conversation composer.
  const modelId = selectedModel ?? defaultModelId ?? modelIds[0] ?? null;

  const selectedRepoId = choice ?? defaultProjectChoice(repos);
  const effectiveNewProjectName =
    newProjectName.trim() || deriveProjectName(text);
  const {
    ownerTargets,
    ownerLogin,
    setOwnerLogin,
    ownersLoading,
    ownersError,
    ownersAction,
    availability,
    nameValidation,
  } = useNewProjectTarget({
    enabled: selectedRepoId === NEW_PROJECT,
    name: effectiveNewProjectName,
  });

  const hasMissionInput = Boolean(text.trim() || files.length > 0);
  const newProjectBlocked =
    selectedRepoId === NEW_PROJECT &&
    (ownersLoading ||
      !ownerLogin ||
      !nameValidation.ok ||
      !CREATABLE_AVAILABILITY.has(availability));
  const submitDisabled = !hasMissionInput || newProjectBlocked || submitting;

  const cyclePermissions = useCallback(() => {
    setPermissionsIdx((i) => (i + 1) % MISSION_PERMISSION_OPTIONS.length);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (submitDisabled) return;
    setProjectError(null);
    setSubmitting(true);

    // Every session is tied to a project: the selected repo, or a new project
    // named explicitly (falling back to a slug derived from the mission).
    const repo = repos.find((r) => r.id === selectedRepoId);
    const options: ComposerSendOptions = {
      model: modelId,
      permissions: MISSION_PERMISSION_OPTIONS[permissionsIdx],
      mode: "run",
      files,
    };

    try {
      let createdRepo: Repo | undefined;
      if (!repo) {
        if (!nameValidation.ok) return;
        const response = await fetchWithActiveTeam("/api/github/repos", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            owner_login: ownerLogin,
            name: nameValidation.name,
          }),
        });
        const data = (await response.json()) as Repo & { error?: string };
        if (!response.ok) {
          throw new Error(data.error || "Failed to create repository");
        }
        createdRepo = data;
        window.localStorage.setItem(LAST_GITHUB_OWNER_KEY, ownerLogin);
      }

      const targetRepo = repo ?? createdRepo;
      const created = await onCreate(
        text.trim(),
        targetRepo ? repoProjectName(targetRepo) : effectiveNewProjectName,
        targetRepo?.id ?? null,
        options,
        createdRepo
      );
      if (created) {
        setText("");
        setFiles([]);
      } else if (createdRepo) {
        setChoice(createdRepo.id);
        setProjectError(
          "Repository created, but the mission could not start. Try again."
        );
      }
    } catch (error) {
      setProjectError(
        error instanceof Error ? error.message : "Failed to create repository"
      );
    } finally {
      setSubmitting(false);
    }
  }, [
    effectiveNewProjectName,
    files,
    modelId,
    nameValidation,
    onCreate,
    ownerLogin,
    permissionsIdx,
    repos,
    selectedRepoId,
    submitDisabled,
    text,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey && !submitDisabled) {
        e.preventDefault();
        void handleSubmit();
      }
    },
    [handleSubmit, submitDisabled]
  );

  return (
    <div className="flex flex-1 flex-col justify-end px-4 py-5 sm:px-8">
      <div className="mx-auto flex w-full max-w-[760px] flex-1 flex-col justify-center">
        {/* Header */}
        <div className="mb-8">
          <MogplexFace
            className="text-foreground mb-3 size-9"
            mood={submitting ? "thinking" : text.trim() ? "listening" : "idle"}
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

        {/* Controls on one centred row, status on its own full-width row —
            keeping the status inside the row made the new-project block taller
            than the project select and knocked the two out of alignment. */}
        <div className="mb-4 flex flex-col gap-1">
          <div
            data-testid="control-project-row"
            className="flex flex-wrap items-center gap-2"
          >
            <label
              htmlFor="control-project"
              className="text-muted-foreground shrink-0 text-xs"
            >
              Project
            </label>
            <ProjectCombobox
              repos={repos}
              value={selectedRepoId}
              newProjectValue={NEW_PROJECT}
              onValueChange={setChoice}
            />
            {selectedRepoId === NEW_PROJECT ? (
              <NewProjectFields
                ownerTargets={ownerTargets}
                ownerLogin={ownerLogin}
                onOwnerChange={setOwnerLogin}
                ownersLoading={ownersLoading}
                name={newProjectName}
                onNameChange={setNewProjectName}
                namePlaceholder={deriveProjectName(text)}
                availability={availability}
              />
            ) : null}
          </div>
          {selectedRepoId === NEW_PROJECT ? (
            <NewProjectStatus
              ownerLogin={ownerLogin}
              ownersError={ownersError}
              ownersAction={ownersAction}
              nameValidation={nameValidation}
              availability={availability}
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
            <div className="bg-accent-blue text-primary-foreground pointer-events-none absolute inset-x-0 top-0 px-3 py-1 text-center text-[11px] font-medium">
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
                const selectedFiles = consumeControlFileInput(
                  event.currentTarget
                );
                await addFiles(selectedFiles);
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
                onClick={() => void handleSubmit()}
                disabled={submitDisabled}
                className={`flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors ${
                  !submitDisabled
                    ? "bg-primary text-primary-foreground hover:bg-brand-accent-hover"
                    : "bg-muted text-muted-foreground cursor-not-allowed"
                }`}
              >
                <SendDiagonal className="size-3.5" strokeWidth={1.8} />
                {submitting ? "Creating project…" : "Start mission"}
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
          {projectError ? (
            <p className="text-accent-red mt-2 text-[11px]">{projectError}</p>
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

"use client";
import { useCallback, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { PatchViewer } from "@/components/diffs/patch-viewer";
import type {
  SandboxChangedFile,
  SandboxCommitResult,
} from "@/lib/sandbox/changes";
import { useSandboxChanges } from "./use-sandbox-changes";

const STATUS_GLYPH: Record<SandboxChangedFile["status"], string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  untracked: "U",
};

const BUTTON =
  "rounded px-2 py-0.5 text-[11px] transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
const QUIET_BUTTON = `${BUTTON} text-muted-foreground hover:bg-muted hover:text-secondary-foreground`;
const DANGER_BUTTON = `${BUTTON} text-accent-red hover:bg-accent-red/10`;
const PRIMARY_BUTTON = `${BUTTON} bg-foreground text-background hover:opacity-90`;

function Counts({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="shrink-0 font-mono text-[11px]">
      <span className="text-addg">+{additions}</span>{" "}
      <span className="text-delr">−{deletions}</span>
    </span>
  );
}

function FileRow({
  file,
  disabled,
  onDiff,
  onRevert,
}: {
  file: SandboxChangedFile;
  disabled: boolean;
  onDiff: (path: string) => void;
  onRevert: (path: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div
      data-testid={`changed-file-${file.path}`}
      className="flex items-center gap-2 px-2 py-1 text-[11px] hover:bg-muted/40"
    >
      <span
        className="w-3 shrink-0 font-mono text-muted-foreground"
        aria-label={file.status}
      >
        {STATUS_GLYPH[file.status]}
      </span>
      <button
        type="button"
        className="min-w-0 flex-1 truncate text-left font-mono hover:underline"
        title={file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}
        onClick={() => onDiff(file.path)}
      >
        {file.path}
      </button>
      <Counts additions={file.additions} deletions={file.deletions} />
      {confirming ? (
        <>
          <button
            type="button"
            className={DANGER_BUTTON}
            data-testid="changed-file-revert-confirm"
            disabled={disabled}
            onClick={() => {
              setConfirming(false);
              onRevert(file.path);
            }}
          >
            Revert?
          </button>
          <button
            type="button"
            className={QUIET_BUTTON}
            onClick={() => setConfirming(false)}
          >
            Keep
          </button>
        </>
      ) : (
        <button
          type="button"
          className={QUIET_BUTTON}
          data-testid="changed-file-revert"
          disabled={disabled}
          onClick={() => setConfirming(true)}
        >
          Revert
        </button>
      )}
    </div>
  );
}

function CommitForm({
  initialMessage,
  busy,
  onCommit,
  onCancel,
}: {
  initialMessage: string;
  busy: boolean;
  onCommit: (message: string, openPullRequest: boolean) => void;
  onCancel: () => void;
}) {
  const [message, setMessage] = useState(initialMessage);
  const canSubmit = message.trim().length > 0 && !busy;
  return (
    <div className="flex flex-col gap-1.5 border-t border-border-dim px-2 py-1.5">
      <textarea
        data-testid="changed-files-commit-message"
        aria-label="Commit message"
        className="min-h-[52px] w-full resize-y rounded border border-border-dim bg-background px-2 py-1 font-mono text-[11px] outline-none focus:border-foreground/40"
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        disabled={busy}
      />
      <div className="flex items-center gap-1">
        <button
          type="button"
          className={PRIMARY_BUTTON}
          data-testid="changed-files-commit-push"
          disabled={!canSubmit}
          onClick={() => onCommit(message.trim(), false)}
        >
          Commit & push
        </button>
        <button
          type="button"
          className={QUIET_BUTTON}
          data-testid="changed-files-commit-pr"
          disabled={!canSubmit}
          onClick={() => onCommit(message.trim(), true)}
        >
          Commit, push & open PR
        </button>
        <button type="button" className={`${QUIET_BUTTON} ml-auto`} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

type Props = {
  sandboxId: string | null;
  /** True while the agent is running; actions are withheld until it stops. */
  disabled: boolean;
  /** Bumped by the pane when a turn ends so the bar re-reads git status. */
  refreshToken: number;
  defaultCommitMessage: string;
};

export function ChangedFilesBar({
  sandboxId,
  disabled,
  refreshToken,
  defaultCommitMessage,
}: Props) {
  const { changes, busy, error, refresh, loadDiff, revert, commit } =
    useSandboxChanges({ sandboxId, refreshToken });
  const [expanded, setExpanded] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [confirmRevertAll, setConfirmRevertAll] = useState(false);
  const [diff, setDiff] = useState<{ path: string; patch: string } | null>(null);
  const [delivery, setDelivery] = useState<SandboxCommitResult | null>(null);

  const showDiff = useCallback(
    async (path: string) => {
      const patch = await loadDiff(path);
      if (patch !== null) setDiff({ path, patch });
    },
    [loadDiff]
  );

  const handleCommit = useCallback(
    async (message: string, openPullRequest: boolean) => {
      const result = await commit({ message, push: true, openPullRequest });
      if (!result) return;
      setDelivery(result);
      setCommitting(false);
    },
    [commit]
  );

  if (!sandboxId || !changes) return null;
  const files = changes.files;
  const totals = files.reduce(
    (acc, file) => ({
      additions: acc.additions + file.additions,
      deletions: acc.deletions + file.deletions,
    }),
    { additions: 0, deletions: 0 }
  );
  if (files.length === 0 && !delivery && !error) return null;
  const actionsDisabled = disabled || busy;

  return (
    <div
      data-testid="changed-files-bar"
      className="border-t border-border-dim bg-background/60 text-[11px]"
    >
      <div className="flex items-center gap-2 px-2 py-1">
        <button
          type="button"
          data-testid="changed-files-toggle"
          className="flex min-w-0 items-center gap-1.5 text-left hover:underline"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
        >
          <span className="text-muted-foreground">{expanded ? "▾" : "▸"}</span>
          <span>
            {files.length} {files.length === 1 ? "file" : "files"} changed
          </span>
          {files.length > 0 ? <Counts {...totals} /> : null}
        </button>
        {changes.branch ? (
          <span
            className="truncate font-mono text-muted-foreground"
            title={changes.branch}
          >
            {changes.branch}
            {changes.ahead > 0 ? ` ↑${changes.ahead}` : ""}
          </span>
        ) : null}
        <span className="ml-auto flex items-center gap-1">
          {files.length > 0 &&
            (confirmRevertAll ? (
              <>
                <button
                  type="button"
                  className={DANGER_BUTTON}
                  data-testid="changed-files-revert-all-confirm"
                  disabled={actionsDisabled}
                  onClick={() => {
                    setConfirmRevertAll(false);
                    void revert(files.map((file) => file.path));
                  }}
                >
                  Revert all?
                </button>
                <button
                  type="button"
                  className={QUIET_BUTTON}
                  onClick={() => setConfirmRevertAll(false)}
                >
                  Keep
                </button>
              </>
            ) : (
              <button
                type="button"
                className={QUIET_BUTTON}
                data-testid="changed-files-revert-all"
                disabled={actionsDisabled}
                onClick={() => setConfirmRevertAll(true)}
              >
                Revert all
              </button>
            ))}
          {(files.length > 0 || changes.ahead > 0) && !committing ? (
            <button
              type="button"
              className={PRIMARY_BUTTON}
              data-testid="changed-files-commit"
              disabled={actionsDisabled}
              onClick={() => {
                setDelivery(null);
                setCommitting(true);
                setExpanded(true);
              }}
            >
              {files.length > 0 ? "Commit…" : "Push"}
            </button>
          ) : null}
          <button
            type="button"
            className={QUIET_BUTTON}
            aria-label="Refresh changes"
            disabled={busy}
            onClick={() => void refresh()}
          >
            ↻
          </button>
        </span>
      </div>
      {error ? (
        <div role="alert" className="px-2 pb-1 text-accent-red">
          {error}
        </div>
      ) : null}
      {delivery ? (
        <div data-testid="changed-files-delivery" className="px-2 pb-1 text-muted-foreground">
          {delivery.pushed ? "Pushed" : delivery.committed ? "Committed" : "Nothing to commit"}
          {changes.branch ? ` ${changes.branch}` : ""}
          {delivery.pullRequestUrl ? (
            <>
              {" · "}
              <a
                className="underline"
                href={delivery.pullRequestUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open pull request
              </a>
            </>
          ) : null}
        </div>
      ) : null}
      {expanded && files.length > 0 ? (
        <div className="max-h-48 overflow-y-auto border-t border-border-dim">
          {files.map((file) => (
            <FileRow
              key={file.path}
              file={file}
              disabled={actionsDisabled}
              onDiff={(path) => void showDiff(path)}
              onRevert={(path) => void revert([path])}
            />
          ))}
        </div>
      ) : null}
      {committing ? (
        <CommitForm
          initialMessage={defaultCommitMessage}
          busy={busy}
          onCommit={(message, openPullRequest) =>
            void handleCommit(message, openPullRequest)
          }
          onCancel={() => setCommitting(false)}
        />
      ) : null}
      <Dialog open={diff !== null} onOpenChange={(open) => !open && setDiff(null)}>
        <DialogContent className="max-h-[80vh] max-w-3xl overflow-y-auto">
          <DialogTitle className="font-mono text-xs">{diff?.path}</DialogTitle>
          {diff?.patch ? (
            <PatchViewer patch={diff.patch} />
          ) : (
            <p className="text-muted-foreground">No textual diff for this file.</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

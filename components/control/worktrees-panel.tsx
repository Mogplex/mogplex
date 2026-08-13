"use client";

import { useState } from "react";
import { GitBranch, Refresh, Trash } from "iconoir-react";
import { isStaleWorktreeReservation } from "@/lib/worktrees/constants";
import type { OrchestrationWorktreeDTO } from "@/lib/worktrees/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const STATUS_STYLE: Record<string, string> = {
  creating: "border-sky-400/25 bg-sky-400/10 text-sky-300",
  active: "border-emerald-400/25 bg-emerald-400/10 text-emerald-300",
  archived: "border-ink-700 bg-ink-800 text-ink-300",
  error: "border-delr/25 bg-delr/10 text-delr",
};

function canArchiveWorktree(worktree: OrchestrationWorktreeDTO): boolean {
  if (worktree.status === "active" || worktree.status === "error") return true;
  if (worktree.status !== "creating") return false;
  return isStaleWorktreeReservation(worktree.updated_at);
}

function worktreeStatusStyle(status: string): string {
  return STATUS_STYLE[status] ?? STATUS_STYLE.archived;
}

function WorktreeRow({
  worktree,
  onAction,
  onDiff,
}: {
  worktree: OrchestrationWorktreeDTO;
  onAction: (
    action: "rebase" | "archive" | "prune",
    id: string,
    options?: { force?: boolean }
  ) => Promise<void>;
  onDiff: (id: string) => Promise<string>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [pruneOpen, setPruneOpen] = useState(false);
  const [forcePruneOpen, setForcePruneOpen] = useState(false);
  const runAction = async (
    action: "rebase" | "archive" | "prune",
    force = false
  ) => {
    setBusy(action);
    setError(null);
    try {
      await onAction(action, worktree.id, { force });
    } catch (actionError) {
      setError(
        actionError instanceof Error ? actionError.message : "Action failed"
      );
      const forceEligible =
        actionError instanceof Error &&
        "forceEligible" in actionError &&
        actionError.forceEligible === true;
      if (action === "prune" && !force && forceEligible) {
        setForcePruneOpen(true);
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <section
      role="region"
      aria-label={`Worktree for task ${worktree.task_id}`}
      className="border-ink-800 border-b py-4 last:border-b-0"
    >
      <div className="flex min-w-0 items-center gap-2">
        <GitBranch className="text-ink-400 size-4 shrink-0" strokeWidth={1.8} />
        <span className="text-ink-100 min-w-0 truncate text-[12.5px] font-medium">
          Task <span className="font-mono">{worktree.task_id}</span>
        </span>
        <span
          aria-label={`Worktree status: ${worktree.status}`}
          className={`rounded-full border px-2 py-0.5 text-[10.5px] ${worktreeStatusStyle(worktree.status)}`}
        >
          {worktree.status.charAt(0).toUpperCase() + worktree.status.slice(1)}
        </span>
      </div>
      <dl className="mt-3 grid gap-2 text-[11.5px] sm:grid-cols-[7rem_minmax(0,1fr)]">
        <dt className="text-ink-500">Branch</dt>
        <dd
          className="text-ink-300 truncate font-mono"
          title={worktree.branch_name}
        >
          {worktree.branch_name}
        </dd>
        <dt className="text-ink-500">Checkout</dt>
        <dd
          className="text-ink-300 truncate font-mono"
          title={worktree.checkout_path}
        >
          {worktree.checkout_path}
        </dd>
        <dt className="text-ink-500">Runs in sandbox</dt>
        <dd className="text-ink-300 truncate font-mono">
          {worktree.sandbox_id}
        </dd>
        {worktree.agent_id ? (
          <>
            <dt className="text-ink-500">Agent run</dt>
            <dd className="text-ink-300 truncate font-mono">
              {worktree.agent_id}
            </dd>
          </>
        ) : null}
      </dl>
      {worktree.error ? (
        <p className="text-delr mt-2 text-xs">{worktree.error}</p>
      ) : null}
      {error ? <p className="text-delr mt-2 text-xs">{error}</p> : null}
      {diff !== null ? (
        <pre className="bg-ink-950 text-ink-300 mt-3 max-h-72 overflow-auto rounded-lg p-3 font-mono text-[11px] leading-5">
          {diff || "No changes from base."}
        </pre>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {worktree.status !== "pruned" ? (
          <button
            type="button"
            onClick={async () => {
              setBusy("diff");
              setError(null);
              try {
                setDiff(await onDiff(worktree.id));
              } catch (diffError) {
                setError(
                  diffError instanceof Error ? diffError.message : "Diff failed"
                );
              } finally {
                setBusy(null);
              }
            }}
            disabled={busy !== null}
            className="border-ink-700 text-ink-200 hover:bg-ink-800 rounded-md border px-2.5 py-1 text-xs disabled:opacity-50"
          >
            Diff
          </button>
        ) : null}
        {worktree.status === "active" ? (
          <button
            type="button"
            onClick={() => void runAction("rebase")}
            disabled={busy !== null}
            className="border-ink-700 text-ink-200 hover:bg-ink-800 flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs disabled:opacity-50"
          >
            <Refresh className="size-3" /> Rebase
          </button>
        ) : null}
        {canArchiveWorktree(worktree) ? (
          <button
            type="button"
            onClick={() => setArchiveOpen(true)}
            disabled={busy !== null}
            className="border-ink-700 text-ink-200 hover:bg-ink-800 rounded-md border px-2.5 py-1 text-xs disabled:opacity-50"
          >
            Archive worktree
          </button>
        ) : null}
        {worktree.status === "archived" ? (
          <button
            type="button"
            onClick={() => setPruneOpen(true)}
            disabled={busy !== null}
            className="border-delr/30 text-delr hover:bg-delr/10 flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs disabled:opacity-50"
          >
            <Trash className="size-3" /> Prune checkout
          </button>
        ) : null}
      </div>
      <AlertDialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <AlertDialogContent className="border-ink-700 bg-ink-900">
          <AlertDialogHeader>
            <AlertDialogTitle>Archive this worktree?</AlertDialogTitle>
            <AlertDialogDescription>
              Archive marks the worktree inactive. Its Git checkout, branch,
              worktree record, and sandbox compute stay.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void runAction("archive")}>
              Archive worktree
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={pruneOpen} onOpenChange={setPruneOpen}>
        <AlertDialogContent className="border-ink-700 bg-ink-900">
          <AlertDialogHeader>
            <AlertDialogTitle>Prune this checkout?</AlertDialogTitle>
            <AlertDialogDescription>
              Prune removes the archived Git checkout and releases its task
              binding. The Git branch, pruned worktree record, and sandbox
              compute stay.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-delr hover:bg-delr/90 text-white"
              onClick={() => void runAction("prune")}
            >
              Prune checkout
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={forcePruneOpen} onOpenChange={setForcePruneOpen}>
        <AlertDialogContent className="border-ink-700 bg-ink-900">
          <AlertDialogHeader>
            <AlertDialogTitle>Retire the sandbox binding?</AlertDialogTitle>
            <AlertDialogDescription>
              Git could not reach the checkout because its sandbox no longer
              exists. Retire the task binding while keeping the Git branch and
              pruned worktree record. No sandbox compute is changed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-delr hover:bg-delr/90 text-white"
              onClick={() => void runAction("prune", true)}
            >
              Retire binding
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

export function WorktreesPanel({
  worktrees,
  loading,
  error,
  onRefresh,
  onAction,
  onDiff,
}: {
  worktrees: OrchestrationWorktreeDTO[];
  loading: boolean;
  error: string | null;
  onRefresh: () => Promise<void>;
  onAction: (
    action: "rebase" | "archive" | "prune",
    id: string,
    options?: { force?: boolean }
  ) => Promise<void>;
  onDiff: (id: string) => Promise<string>;
}) {
  return (
    <div className="mx-auto w-full max-w-5xl flex-1 overflow-y-auto px-4 py-6 sm:px-6">
      <div className="border-ink-800 border-b pb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-ink-300 text-xs font-semibold tracking-wider uppercase">
            Worktrees
          </h2>
          <span className="text-ink-400 text-[12.5px]">
            {loading
              ? "Loading checkouts"
              : `${worktrees.length} checkout${worktrees.length === 1 ? "" : "s"}`}
          </span>
          <button
            type="button"
            onClick={() => void onRefresh()}
            disabled={loading}
            className="border-ink-700 text-ink-300 hover:bg-ink-800 ml-auto flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs disabled:opacity-50"
          >
            <Refresh className="size-3" /> Refresh
          </button>
        </div>
        <p className="text-ink-500 mt-1 max-w-2xl text-xs leading-5">
          Task-specific Git checkouts inside sandbox compute. Archiving or
          pruning a worktree does not stop its sandbox.
        </p>
      </div>
      {error ? (
        <div
          role="alert"
          className="border-delr/30 bg-delr/5 text-delr mt-4 rounded-lg border px-4 py-3 text-xs"
        >
          {error}
        </div>
      ) : null}
      {loading ? (
        <div
          role="status"
          className="py-8"
          aria-label="Loading worktree checkouts"
        >
          <span className="sr-only">Loading worktree checkouts</span>
          <div className="bg-ink-800 h-3 w-40 animate-pulse rounded" />
          <div className="bg-ink-850 mt-3 h-3 w-full max-w-lg animate-pulse rounded" />
          <div className="bg-ink-850 mt-2 h-3 w-3/4 max-w-md animate-pulse rounded" />
        </div>
      ) : worktrees.length === 0 ? (
        <div className="text-ink-400 py-10 text-sm">
          <p className="text-ink-200 font-medium">No worktrees yet</p>
          <p className="text-ink-500 mt-1 max-w-xl text-xs leading-5">
            Delegating a coding task creates its isolated checkout inside the
            selected sandbox. Starting compute alone does not create one.
          </p>
        </div>
      ) : (
        worktrees.map((worktree) => (
          <WorktreeRow
            key={worktree.id}
            worktree={worktree}
            onAction={onAction}
            onDiff={onDiff}
          />
        ))
      )}
    </div>
  );
}

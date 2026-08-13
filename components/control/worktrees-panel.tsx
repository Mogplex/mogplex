"use client";

import { useState } from "react";
import { GitBranch, Refresh, Trash } from "iconoir-react";
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

const STALE_CREATING_MS = 5 * 60 * 1000;

function canArchiveWorktree(worktree: OrchestrationWorktreeDTO): boolean {
  if (worktree.status === "active" || worktree.status === "error") return true;
  if (worktree.status !== "creating") return false;
  const updatedAt = Date.parse(worktree.updated_at);
  return (
    Number.isFinite(updatedAt) && updatedAt < Date.now() - STALE_CREATING_MS
  );
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
    <div className="border-ink-800 border-b py-4 last:border-b-0">
      <div className="flex min-w-0 items-center gap-2">
        <GitBranch className="text-ink-400 size-4 shrink-0" strokeWidth={1.8} />
        <span className="text-ink-100 min-w-0 truncate font-mono text-[12.5px]">
          {worktree.branch_name}
        </span>
        <span
          className={`rounded-full border px-2 py-0.5 text-[10.5px] ${STATUS_STYLE[worktree.status] ?? STATUS_STYLE.archived}`}
        >
          {worktree.status}
        </span>
      </div>
      <dl className="mt-3 grid gap-2 text-[11.5px] sm:grid-cols-[7rem_minmax(0,1fr)]">
        <dt className="text-ink-500">Checkout</dt>
        <dd
          className="text-ink-300 truncate font-mono"
          title={worktree.checkout_path}
        >
          {worktree.checkout_path}
        </dd>
        <dt className="text-ink-500">Sandbox binding</dt>
        <dd className="text-ink-300 truncate font-mono">
          {worktree.sandbox_id}
        </dd>
        <dt className="text-ink-500">Task</dt>
        <dd className="text-ink-300 truncate font-mono">{worktree.task_id}</dd>
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
            onClick={() => void runAction("archive")}
            disabled={busy !== null}
            className="border-ink-700 text-ink-200 hover:bg-ink-800 rounded-md border px-2.5 py-1 text-xs disabled:opacity-50"
          >
            Archive
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
      <AlertDialog open={pruneOpen} onOpenChange={setPruneOpen}>
        <AlertDialogContent className="border-ink-700 bg-ink-900">
          <AlertDialogHeader>
            <AlertDialogTitle>Prune this checkout?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the archived Git checkout from its sandbox. It does
              not stop the sandbox or delete the branch.
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
              Git could not remove the checkout. Use this only when the sandbox
              no longer exists. Mogplex will retire the database binding but
              will not delete the branch.
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
    </div>
  );
}

export function WorktreesPanel({
  worktrees,
  loading,
  onAction,
  onDiff,
}: {
  worktrees: OrchestrationWorktreeDTO[];
  loading: boolean;
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
        <div className="flex items-baseline gap-2">
          <h2 className="text-ink-300 text-xs font-semibold tracking-wider uppercase">
            Worktrees
          </h2>
          <span className="text-ink-400 text-[12.5px]">
            {loading
              ? "Loading"
              : `${worktrees.length} checkout${worktrees.length === 1 ? "" : "s"}`}
          </span>
        </div>
        <p className="text-ink-500 mt-1 max-w-2xl text-xs leading-5">
          Isolated Git checkouts assigned to mission tasks. Sandbox compute can
          stop or resume without changing this list.
        </p>
      </div>
      {!loading && worktrees.length === 0 ? (
        <div className="text-ink-400 py-10 text-sm">
          No worktrees. Delegating a task creates its checkout in a selected
          sandbox.
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

"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { Repo } from "@/lib/types";

/** Remove button that asks before hiding repositories from Mogplex. */
export function ConfirmRemoveButton({
  label,
  ariaLabel,
  title,
  confirmLabel,
  disabled,
  onConfirm,
}: {
  label: string;
  ariaLabel?: string;
  title: string;
  confirmLabel: string;
  disabled?: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={ariaLabel}
          disabled={disabled}
          className="text-destructive hover:text-destructive"
        >
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>
            Removed repositories disappear from Command Center and project
            pickers. Nothing changes on GitHub, and you can restore them from
            Show removed.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * One repository in Settings → Repositories. Connected rows open project
 * settings or remove (after confirmation); removed rows restore at once.
 */
export function RepositoryRow({
  repo,
  pending,
  notConnected = false,
  onToggle,
  onOpenSettings,
}: {
  repo: Repo;
  pending: boolean;
  /** Mark a repository without the GitHub App inside a partly connected owner. */
  notConnected?: boolean;
  onToggle: (repo: Repo) => void;
  onOpenSettings: (repo: Repo) => void;
}) {
  const removed = Boolean(repo.is_hidden);
  return (
    <li className="border-border flex items-center justify-between gap-3 border-b px-3 py-2 last:border-b-0">
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate text-sm">{repo.full_name}</span>
        {notConnected ? (
          <span className="border-destructive/40 text-destructive shrink-0 rounded-full border px-2 py-0.5 text-[11px]">
            Not connected
          </span>
        ) : null}
      </span>
      <div className="flex shrink-0 items-center gap-1">
        {removed ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Restore ${repo.full_name}`}
            disabled={pending}
            onClick={() => onToggle(repo)}
          >
            Restore
          </Button>
        ) : (
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Settings for ${repo.full_name}`}
              onClick={() => onOpenSettings(repo)}
            >
              Settings
            </Button>
            <ConfirmRemoveButton
              label="Remove"
              ariaLabel={`Remove ${repo.full_name}`}
              title={`Remove ${repo.full_name}?`}
              confirmLabel="Remove repository"
              disabled={pending}
              onConfirm={() => onToggle(repo)}
            />
          </>
        )}
      </div>
    </li>
  );
}

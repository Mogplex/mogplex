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
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type TopBarPromptKind = "command" | "branch" | "rename";

const PROMPT_META: Record<
  TopBarPromptKind,
  { title: string; label: string; submit: string }
> = {
  command: { title: "Run custom command", label: "Command", submit: "Run" },
  branch: {
    title: "Commit to new branch",
    label: "Branch name",
    submit: "Commit",
  },
  rename: { title: "Rename task", label: "Title", submit: "Rename" },
};

/** Single text-input dialog shared by the top bar's prompt actions. */
export function TopBarPromptDialog({
  kind,
  value,
  onChange,
  onSubmit,
  onClose,
}: {
  kind: TopBarPromptKind | null;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const meta = kind ? PROMPT_META[kind] : null;
  return (
    <Dialog
      open={kind !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="border-ink-700 bg-ink-900 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{meta?.title ?? ""}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <label className="block text-xs text-ink-400">
            {meta?.label ?? ""}
            <input
              value={value}
              onChange={(event) => onChange(event.target.value)}
              autoFocus
              className="mt-1.5 w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-2 font-mono text-sm text-ink-100 outline-none focus:border-ink-600"
            />
          </label>
          <DialogFooter className="mt-4">
            <button
              type="submit"
              disabled={!value.trim()}
              className="rounded-lg bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-brand-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {meta?.submit ?? ""}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Destructive confirmation behind "Discard all changes…". */
export function DiscardChangesDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="border-ink-700 bg-ink-900">
        <AlertDialogHeader>
          <AlertDialogTitle>Discard all changes?</AlertDialogTitle>
          <AlertDialogDescription>
            The agent will run a hard reset and clean in the working tree.
            Uncommitted work will be lost.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-delr text-ink-950 hover:bg-delr/90"
            onClick={onConfirm}
          >
            Discard changes
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

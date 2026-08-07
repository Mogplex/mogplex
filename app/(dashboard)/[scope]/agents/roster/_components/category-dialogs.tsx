"use client";

import { MAX_AGENT_CATEGORY_LABEL_LENGTH } from "@/lib/agents/category-utils";
import type { AgentCategoryRow } from "@/lib/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

export function NewCategoryDialog({
  open,
  label,
  setLabel,
  saving,
  error,
  onClose,
  onCreate,
}: {
  open: boolean;
  label: string;
  setLabel: (v: string) => void;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onCreate: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="w-[min(94vw,420px)]">
        <DialogHeader>
          <DialogTitle className="text-base">New category</DialogTitle>
          <DialogDescription>
            Create a custom category to group your agents.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <label htmlFor="new-category-label" className="ui-label block">
            Name
          </label>
          <input
            id="new-category-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={MAX_AGENT_CATEGORY_LABEL_LENGTH}
            placeholder="e.g. Ops"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void onCreate();
              }
            }}
            className="bg-input border-border text-foreground w-full rounded-sm border px-3 py-2 text-sm"
          />
          {error && <div className="text-destructive text-sm">{error}</div>}
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={onClose}
              disabled={saving}
              className="text-muted-foreground hover:text-foreground px-3 py-1.5 text-sm disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={onCreate}
              disabled={saving || !label.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-sm px-3 py-1.5 text-sm disabled:opacity-50"
            >
              {saving ? "Creating..." : "Create"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ManageCategoriesDialog({
  open,
  setOpen,
  customCategories,
  onDelete,
  onNewCategory,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  customCategories: AgentCategoryRow[];
  onDelete: (c: AgentCategoryRow) => void;
  onNewCategory: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="w-[min(94vw,480px)]">
        <DialogHeader>
          <DialogTitle className="text-base">Manage categories</DialogTitle>
          <DialogDescription>
            Add and remove your custom categories. Built-in categories
            can&apos;t be removed.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {customCategories.length === 0 ? (
            <div className="ui-meta">
              You haven&apos;t added any custom categories yet.
            </div>
          ) : (
            <ul className="divide-border border-border divide-y rounded-sm border">
              {customCategories.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between gap-2 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="text-foreground truncate text-sm">
                      {c.label}
                    </div>
                    <div className="text-muted-foreground truncate font-mono text-[11px]">
                      {c.slug}
                    </div>
                  </div>
                  <button
                    onClick={() => onDelete(c)}
                    className="text-destructive shrink-0 text-sm hover:underline"
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex justify-between gap-2 pt-1">
            <button
              onClick={() => {
                setOpen(false);
                onNewCategory();
              }}
              className="border-border text-foreground hover:bg-secondary rounded-sm border px-3 py-1.5 text-sm"
            >
              + New category
            </button>
            <button
              onClick={() => setOpen(false)}
              className="text-muted-foreground hover:text-foreground px-3 py-1.5 text-sm"
            >
              Done
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteCategoryDialog({
  category,
  deleting,
  onCancel,
  onConfirm,
}: {
  category: AgentCategoryRow | null;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog
      open={!!category}
      onOpenChange={(open) => {
        if (!open && !deleting) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this category?</AlertDialogTitle>
          <AlertDialogDescription>
            {category
              ? `"${category.label}" will be removed. Any agents using it will move to "Needs Category".`
              : null}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              void onConfirm();
            }}
            disabled={deleting}
          >
            {deleting ? "Deleting..." : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

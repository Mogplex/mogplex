"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { stripDirectoryTreePath } from "@/lib/file-tree-paths";
import type { TreeCreateKind } from "./helpers";

interface CreateFileDialogProps {
  open: boolean;
  kind: TreeCreateKind | null;
  path: string;
  creating: boolean;
  onPathChange: (path: string) => void;
  onClose: () => void;
  onCreate: () => void;
}

export function CreateFileDialog({
  open,
  kind,
  path,
  creating,
  onPathChange,
  onClose,
  onCreate,
}: CreateFileDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {kind === "directory" ? "Create folder" : "Create file"}
          </DialogTitle>
          <DialogDescription>
            Enter a repo-relative path. Folder paths can be nested.
          </DialogDescription>
        </DialogHeader>
        <Input
          value={path}
          onChange={(event) => onPathChange(event.target.value)}
          placeholder={
            kind === "directory" ? "src/new-folder/" : "src/new-file.ts"
          }
          autoFocus
        />
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={creating}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onCreate}
            disabled={creating || !path.trim()}
          >
            {creating ? "Creating..." : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface DeleteFileDialogProps {
  target: { kind: "directory" | "file"; path: string } | null;
  deleting: boolean;
  onClose: () => void;
  onDelete: () => void;
}

export function DeleteFileDialog({
  target,
  deleting,
  onClose,
  onDelete,
}: DeleteFileDialogProps) {
  return (
    <AlertDialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete {target?.kind === "directory" ? "folder" : "file"}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {target
              ? `This will permanently remove ${stripDirectoryTreePath(target.path)} from the sandbox.`
              : "This will permanently remove the selected path from the sandbox."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onDelete}
            disabled={deleting}
            className="bg-destructive hover:bg-destructive/90"
          >
            {deleting ? "Deleting..." : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

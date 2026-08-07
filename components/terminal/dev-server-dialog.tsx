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

export type PendingDevServerConfirmation = {
  command: string;
  previewUrl: string;
};

type DevServerDialogProps = {
  pending: PendingDevServerConfirmation | null;
  onCancel: () => void;
  onConfirm: () => void;
};

export function DevServerDialog({
  pending,
  onCancel,
  onConfirm,
}: DevServerDialogProps) {
  return (
    <AlertDialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Dev server already running</AlertDialogTitle>
          <AlertDialogDescription>
            Mogplex already sees a healthy preview at{" "}
            <span className="text-foreground font-mono">
              {pending?.previewUrl}
            </span>
            . Starting another dev server may conflict on port 3000.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Run anyway</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

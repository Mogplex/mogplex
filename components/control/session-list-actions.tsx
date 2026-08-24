"use client";

import {
  forwardRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { ChatPlusIn, MoreHoriz, Trash } from "iconoir-react";
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
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ControlSessionSummary } from "@/lib/control/session-types";

export type NewSessionTarget = {
  project: string | null;
  repoId: string | null;
};

const ActionButton = forwardRef<
  HTMLButtonElement,
  { label: string } & ButtonHTMLAttributes<HTMLButtonElement>
>(({ label, onClick, ...props }, ref) => (
  <button
    {...props}
    ref={ref}
    type="button"
    aria-label={label}
    title={label}
    onClick={(event) => {
      event.stopPropagation();
      onClick?.(event);
    }}
    className="text-ink-400 hover:bg-ink-700 hover:text-ink-100 focus-visible:ring-ring grid size-7 shrink-0 place-items-center rounded-md outline-none focus-visible:ring-2"
  >
    <MoreHoriz className="size-4" aria-hidden="true" />
  </button>
));
ActionButton.displayName = "ActionButton";

export function ProjectRowActions({
  children,
  projectName,
  onNew,
}: {
  children: ReactNode;
  projectName: string;
  onNew: () => void;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="group flex min-w-0 items-center">
          {children}
          <ProjectActionButton projectName={projectName} onNew={onNew} />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent aria-label={`Actions for ${projectName}`}>
        <ContextMenuItem onSelect={onNew}>
          <ChatPlusIn aria-hidden="true" />
          New chat
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function ProjectActionButton({
  projectName,
  onNew,
}: {
  projectName: string;
  onNew: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <ActionButton label={`Actions for ${projectName}`} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" aria-label={`Actions for ${projectName}`}>
        <DropdownMenuItem onSelect={onNew}>
          <ChatPlusIn aria-hidden="true" />
          New chat
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SessionRowActions({
  children,
  session,
  onDelete,
}: {
  children: ReactNode;
  session: ControlSessionSummary;
  onDelete: (id: string) => Promise<boolean>;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const openConfirmation = () => {
    setDeleteError(null);
    setConfirmOpen(true);
  };

  const confirmDelete = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (deleting) return;
    setDeleting(true);
    setDeleteError(null);
    const deleted = await onDelete(session.id);
    setDeleting(false);
    if (deleted) setConfirmOpen(false);
    else setDeleteError("The chat could not be deleted. Try again.");
  };

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="group flex min-w-0 items-center">
            {children}
            <SessionActionButton
              session={session}
              onDelete={openConfirmation}
            />
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent aria-label={`Actions for ${session.title}`}>
          <ContextMenuItem variant="destructive" onSelect={openConfirmation}>
            <Trash aria-hidden="true" />
            Delete chat
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{`Delete ${session.title}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the chat history. Repository work and
              running agents are not deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError ? (
            <p role="alert" className="text-destructive text-sm">
              {deleteError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deleting…" : "Delete chat"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function SessionActionButton({
  session,
  onDelete,
}: {
  session: ControlSessionSummary;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <ActionButton label={`Actions for ${session.title}`} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" aria-label={`Actions for ${session.title}`}>
        <DropdownMenuItem variant="destructive" onSelect={onDelete}>
          <Trash aria-hidden="true" />
          Delete chat
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

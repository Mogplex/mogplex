"use client";
import type { PaneNode, PaneType, TerminalSessionSummary } from "@/hooks/use-split-panes";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Plus,
  Xmark,
  Terminal as TerminalIcon,
  EditPencil,
  ListSelect,
} from "iconoir-react";
import { PANE_TYPE_GROUPS } from "./pane-constants";

interface PaneActionsMenuProps {
  pane: PaneNode;
  currentTerminalSession: TerminalSessionSummary | null;
  otherTerminalSessions: TerminalSessionSummary[];
  splitSandboxOverrides?: Partial<PaneNode>;
  onSplit: (
    dir: "horizontal" | "vertical",
    type: PaneType,
    overrides?: Partial<PaneNode>
  ) => void;
  onAttachTerminalSession: (
    dir: "horizontal" | "vertical",
    session: TerminalSessionSummary
  ) => void;
  onRenameTerminalSession: () => void;
  onResetTerminalSession: () => void;
}

export function PaneActionsMenu({
  pane,
  currentTerminalSession,
  otherTerminalSessions,
  splitSandboxOverrides,
  onSplit,
  onAttachTerminalSession,
  onRenameTerminalSession,
  onResetTerminalSession,
}: PaneActionsMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          onClick={(e) => e.stopPropagation()}
          data-testid={`pane-add-${pane.id}`}
          className="text-muted-foreground hover:bg-muted hover:text-secondary-foreground flex h-6 w-6 items-center justify-center rounded-[4px] text-sm"
          title={
            pane.type === "terminal"
              ? "Pane and session actions"
              : "Add pane"
          }
        >
          <Plus className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {pane.type === "terminal" && currentTerminalSession && (
          <TerminalSessionActions
            currentTerminalSession={currentTerminalSession}
            otherTerminalSessions={otherTerminalSessions}
            onAttachTerminalSession={onAttachTerminalSession}
            onRenameTerminalSession={onRenameTerminalSession}
            onResetTerminalSession={onResetTerminalSession}
          />
        )}
        <PaneTypeMenuItems
          splitSandboxOverrides={splitSandboxOverrides}
          onSplit={onSplit}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TerminalSessionActions({
  currentTerminalSession,
  otherTerminalSessions,
  onAttachTerminalSession,
  onRenameTerminalSession,
  onResetTerminalSession,
}: {
  currentTerminalSession: TerminalSessionSummary;
  otherTerminalSessions: TerminalSessionSummary[];
  onAttachTerminalSession: (
    dir: "horizontal" | "vertical",
    session: TerminalSessionSummary
  ) => void;
  onRenameTerminalSession: () => void;
  onResetTerminalSession: () => void;
}) {
  return (
    <>
      <DropdownMenuLabel className="text-[11px] tracking-wider uppercase">
        Session
      </DropdownMenuLabel>
      <DropdownMenuItem
        onSelect={() => onAttachTerminalSession("horizontal", currentTerminalSession)}
        className="gap-2 text-[13px]"
      >
        <span className="text-muted-foreground w-4 text-center">
          <TerminalIcon className="size-3.5" />
        </span>
        Attach Right
      </DropdownMenuItem>
      <DropdownMenuItem
        onSelect={() => onAttachTerminalSession("vertical", currentTerminalSession)}
        className="gap-2 text-[13px]"
      >
        <span className="text-muted-foreground w-4 text-center">
          <TerminalIcon className="size-3.5" />
        </span>
        Attach Below
      </DropdownMenuItem>
      {otherTerminalSessions.length > 0 && (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="gap-2 text-[13px]">
            <span className="text-muted-foreground w-4 text-center">
              <ListSelect className="size-3.5" />
            </span>
            Attach Existing
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-56">
            {otherTerminalSessions.map((session) => (
              <DropdownMenuItem
                key={session.terminalSessionKey}
                onSelect={() => onAttachTerminalSession("horizontal", session)}
                className="flex items-center gap-2 text-[13px]"
              >
                <span className="truncate">{session.name}</span>
                <span className="text-muted-foreground ml-auto text-[11px]">
                  {session.paneIds.length} pane
                  {session.paneIds.length === 1 ? "" : "s"}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      )}
      <DropdownMenuItem
        onSelect={onRenameTerminalSession}
        className="gap-2 text-[13px]"
      >
        <span className="text-muted-foreground w-4 text-center">
          <EditPencil className="size-3.5" />
        </span>
        Rename Session
      </DropdownMenuItem>
      <DropdownMenuItem
        onSelect={onResetTerminalSession}
        className="gap-2 text-[13px] text-red-500 focus:text-red-500"
      >
        <span className="w-4 text-center text-red-500">
          <Xmark className="size-3.5" />
        </span>
        Reset Session
      </DropdownMenuItem>
      <DropdownMenuSeparator />
    </>
  );
}

function PaneTypeMenuItems({
  splitSandboxOverrides,
  onSplit,
}: {
  splitSandboxOverrides?: Partial<PaneNode>;
  onSplit: (
    dir: "horizontal" | "vertical",
    type: PaneType,
    overrides?: Partial<PaneNode>
  ) => void;
}) {
  return (
    <>
      {PANE_TYPE_GROUPS.map((group, gi) => (
        <div key={group.label}>
          {gi > 0 && <DropdownMenuSeparator />}
          <DropdownMenuLabel className="text-[11px] tracking-wider uppercase">
            {group.label}
          </DropdownMenuLabel>
          {group.items.map((item) => (
            <DropdownMenuItem
              key={item.type}
              onSelect={() => onSplit("horizontal", item.type, splitSandboxOverrides)}
              className="gap-2 text-[13px]"
            >
              <span className="text-muted-foreground w-4 text-center">
                {item.icon}
              </span>
              {item.name}
            </DropdownMenuItem>
          ))}
        </div>
      ))}
      <DropdownMenuSeparator />
      <DropdownMenuLabel className="text-[11px] tracking-wider uppercase">
        Split below
      </DropdownMenuLabel>
      {PANE_TYPE_GROUPS.flatMap((group) => group.items).map((item) => (
        <DropdownMenuItem
          key={`v-${item.type}`}
          onSelect={() => onSplit("vertical", item.type, splitSandboxOverrides)}
          className="gap-2 text-[13px]"
        >
          <span className="text-muted-foreground w-4 text-center">
            {item.icon}
          </span>
          {item.name}
        </DropdownMenuItem>
      ))}
    </>
  );
}

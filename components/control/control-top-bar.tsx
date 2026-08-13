"use client";

import { useState } from "react";
import {
  Archive,
  Book,
  Clock,
  Copy,
  Download,
  EditPencil,
  Eye,
  Flask,
  GitBranch,
  GitCommit,
  GitPullRequest,
  Github,
  Link,
  MoreVert,
  NavArrowDown,
  Package,
  Play,
  Plus,
  Refresh,
  Terminal,
  Trash,
  Type,
} from "iconoir-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  DiscardChangesDialog,
  TopBarPromptDialog,
  type TopBarPromptKind,
} from "./control-top-bar-dialogs";

export type ControlTopBarProps = {
  /** Project/repo label for the breadcrumb; null when nothing is selected. */
  projectName: string | null;
  /** Selected session/mission title; null when nothing is selected. */
  sessionTitle: string | null;
  /** Branch the commit actions target (active sandbox or mission base). */
  branch: string;
  /** A chat session is active, so agent instructions can be sent. */
  hasSession: boolean;
  /** A run is streaming; agent instructions are blocked until it ends. */
  chatPending: boolean;
  /** Preview URL of the most recently active running sandbox, if any. */
  previewUrl: string | null;
  /** full_name of the repo behind the active sandbox, if known. */
  repoFullName: string | null;
  /** Streams an instruction to the agent (same path as the composer). */
  onSendInstruction: (text: string) => void;
  onOpenTerminal: () => void;
  onStartSandbox: () => void;
  onScheduleAutomation: () => void;
  onRename: (title: string) => void;
  onArchive: () => void;
  onExportTranscript: () => void;
  onCopyLink: () => void;
};

const TRIGGER_CLASS =
  "flex items-center gap-1.5 rounded-lg border border-ink-700 bg-ink-850 px-3 py-1.5 text-[13px] font-medium text-ink-200 transition-colors hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-50";
const MENU_CLASS =
  "w-64 rounded-lg border border-ink-700 bg-ink-850 py-1.5 text-[13px] shadow-2xl shadow-black/50";
const SEPARATOR_CLASS = "my-1.5 bg-ink-700/70";

function Item({
  icon: Icon,
  danger = false,
  disabled,
  title,
  onSelect,
  children,
}: {
  icon: typeof Flask;
  danger?: boolean;
  disabled?: boolean;
  title?: string;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <DropdownMenuItem
      disabled={disabled}
      title={title}
      onSelect={onSelect}
      className={`flex items-center gap-2.5 px-3 py-1.5 ${
        danger ? "text-delr" : "text-ink-200"
      }`}
    >
      <Icon
        className={`size-3.5 shrink-0 ${danger ? "" : "text-ink-400"}`}
        strokeWidth={1.8}
      />
      {children}
    </DropdownMenuItem>
  );
}

export function ControlTopBar({
  projectName,
  sessionTitle,
  branch,
  hasSession,
  chatPending,
  previewUrl,
  repoFullName,
  onSendInstruction,
  onOpenTerminal,
  onStartSandbox,
  onScheduleAutomation,
  onRename,
  onArchive,
  onExportTranscript,
  onCopyLink,
}: ControlTopBarProps) {
  const [prompt, setPrompt] = useState<TopBarPromptKind | null>(null);
  const [promptValue, setPromptValue] = useState("");
  const [discardOpen, setDiscardOpen] = useState(false);

  const agentReady = hasSession && !chatPending;
  const agentBlockReason = !hasSession
    ? "Select a session first"
    : chatPending
      ? "Wait for the current run to finish"
      : undefined;

  const openPrompt = (kind: TopBarPromptKind, initial = "") => {
    setPromptValue(initial);
    setPrompt(kind);
  };

  const submitPrompt = () => {
    const value = promptValue.trim();
    if (!value) return;
    if (prompt === "command") {
      onSendInstruction(
        `Run this command in the project and report its output: \`${value}\``
      );
    } else if (prompt === "branch") {
      onSendInstruction(
        `Create a new branch named \`${value}\` from the current state, commit the current changes with a conventional commit message, and push the new branch.`
      );
    } else if (prompt === "rename") {
      onRename(value);
    }
    setPrompt(null);
    setPromptValue("");
  };

  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-ink-800 px-4 py-3 sm:px-6">
      <div className="flex min-w-0 items-center gap-2 text-[15px]">
        <Book
          className="size-3.5 shrink-0 text-ink-400"
          strokeWidth={1.8}
          aria-hidden="true"
        />
        <span className="truncate text-ink-400">{projectName ?? "Control"}</span>
        <NavArrowDown
          className="size-3.5 shrink-0 -rotate-90 text-ink-600"
          strokeWidth={2}
          aria-hidden="true"
        />
        <span className="truncate font-semibold text-ink-100">
          {sessionTitle ?? "No session selected"}
        </span>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={TRIGGER_CLASS}>
              <Plus className="size-3.5" strokeWidth={2} />
              Add action
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className={MENU_CLASS}>
            <Item
              icon={Flask}
              disabled={!agentReady}
              title={agentBlockReason}
              onSelect={() =>
                onSendInstruction(
                  "Run the project's test suite and report the results. If anything fails, show the failing output."
                )
              }
            >
              Run tests
            </Item>
            <Item
              icon={Type}
              disabled={!agentReady}
              title={agentBlockReason}
              onSelect={() =>
                onSendInstruction(
                  "Run the project's typecheck (for example `tsc --noEmit` or the repo's typecheck script) and report the results."
                )
              }
            >
              Typecheck
            </Item>
            <Item
              icon={Terminal}
              disabled={!agentReady}
              title={agentBlockReason}
              onSelect={() => openPrompt("command")}
            >
              Run custom command…
            </Item>
            <DropdownMenuSeparator className={SEPARATOR_CLASS} />
            <Item
              icon={GitPullRequest}
              disabled={!agentReady}
              title={agentBlockReason}
              onSelect={() =>
                onSendInstruction(
                  "Create a pull request for the current work: commit any pending changes with a conventional commit message, push the branch, and open a pull request with a clear title and summary."
                )
              }
            >
              Create pull request
            </Item>
            <Item
              icon={Eye}
              disabled={!previewUrl && !agentReady}
              title={
                previewUrl
                  ? previewUrl
                  : (agentBlockReason ?? "No sandbox preview available")
              }
              onSelect={() => {
                if (previewUrl) {
                  window.open(previewUrl, "_blank", "noreferrer");
                } else {
                  onSendInstruction(
                    "Start the project's dev server in the sandbox and share its preview URL."
                  );
                }
              }}
            >
              Deploy preview
            </Item>
            <DropdownMenuSeparator className={SEPARATOR_CLASS} />
            <Item icon={Package} onSelect={onStartSandbox}>
              Start sandbox
            </Item>
            <Item icon={Clock} onSelect={onScheduleAutomation}>
              Schedule automation
            </Item>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={TRIGGER_CLASS}>
              <Play className="size-3.5" strokeWidth={1.8} />
              Open
              <NavArrowDown className="size-3 text-ink-400" strokeWidth={2} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className={MENU_CLASS}>
            {previewUrl ? (
              <Item
                icon={Eye}
                onSelect={() =>
                  window.open(previewUrl, "_blank", "noreferrer")
                }
              >
                Open sandbox preview
              </Item>
            ) : null}
            <Item icon={Terminal} onSelect={onOpenTerminal}>
              Terminal
            </Item>
            {repoFullName ? (
              <>
                <Item
                  icon={Github}
                  onSelect={() =>
                    window.open(
                      `https://github.com/${repoFullName}`,
                      "_blank",
                      "noreferrer"
                    )
                  }
                >
                  View on GitHub
                </Item>
                <Item
                  icon={Copy}
                  onSelect={() =>
                    navigator.clipboard.writeText(
                      `git clone https://github.com/${repoFullName}.git`
                    )
                  }
                >
                  Copy clone command
                </Item>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={TRIGGER_CLASS}
              disabled={!hasSession}
              title={hasSession ? undefined : "Select a session to commit from"}
            >
              <GitCommit className="size-3.5" strokeWidth={1.8} />
              Commit &amp; push
              <NavArrowDown className="size-3 text-ink-400" strokeWidth={2} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className={MENU_CLASS}>
            <Item
              icon={GitCommit}
              disabled={!agentReady}
              title={agentBlockReason}
              onSelect={() =>
                onSendInstruction(
                  `Commit the current changes with a conventional commit message and push the \`${branch}\` branch.`
                )
              }
            >
              Commit &amp; push to{" "}
              <span className="font-mono text-[12px]">{branch}</span>
            </Item>
            <Item
              icon={GitCommit}
              disabled={!agentReady}
              title={agentBlockReason}
              onSelect={() =>
                onSendInstruction(
                  "Commit the current changes with a conventional commit message. Do not push."
                )
              }
            >
              Commit only
            </Item>
            <Item
              icon={GitBranch}
              disabled={!agentReady}
              title={agentBlockReason}
              onSelect={() => openPrompt("branch")}
            >
              Commit to new branch…
            </Item>
            <DropdownMenuSeparator className={SEPARATOR_CLASS} />
            <Item
              icon={EditPencil}
              disabled={!agentReady}
              title={agentBlockReason}
              onSelect={() =>
                onSendInstruction(
                  "Amend the last commit to include the current changes. Do not push."
                )
              }
            >
              Amend last commit
            </Item>
            <Item
              icon={Refresh}
              disabled={!agentReady}
              title={agentBlockReason}
              onSelect={() =>
                onSendInstruction(
                  "Pull the latest `main` and rebase the current branch on it, resolving any conflicts."
                )
              }
            >
              Pull &amp; rebase on{" "}
              <span className="font-mono text-[12px]">main</span>
            </Item>
            <DropdownMenuSeparator className={SEPARATOR_CLASS} />
            <Item
              icon={Archive}
              disabled={!agentReady}
              title={agentBlockReason}
              onSelect={() =>
                onSendInstruction(
                  "Stash the current uncommitted changes with a descriptive stash message."
                )
              }
            >
              Stash changes
            </Item>
            <Item
              icon={Trash}
              danger
              disabled={!agentReady}
              title={agentBlockReason}
              onSelect={() => setDiscardOpen(true)}
            >
              Discard all changes…
            </Item>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="More options"
              className="rounded-lg border border-ink-700 bg-ink-850 p-2 text-ink-300 transition-colors hover:bg-ink-800"
            >
              <MoreVert className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className={`${MENU_CLASS} w-56`}>
            <Item
              icon={EditPencil}
              disabled={!hasSession}
              title={hasSession ? undefined : "Select a session first"}
              onSelect={() => openPrompt("rename", sessionTitle ?? "")}
            >
              Rename task
            </Item>
            <Item
              icon={Link}
              disabled={!hasSession}
              title={hasSession ? undefined : "Select a session first"}
              onSelect={onCopyLink}
            >
              Copy link
            </Item>
            <Item
              icon={Download}
              disabled={!hasSession}
              title={hasSession ? undefined : "Select a session first"}
              onSelect={onExportTranscript}
            >
              Export transcript
            </Item>
            <DropdownMenuSeparator className={SEPARATOR_CLASS} />
            <Item
              icon={Archive}
              disabled={!hasSession}
              title={hasSession ? undefined : "Select a session first"}
              onSelect={onArchive}
            >
              Archive
            </Item>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <TopBarPromptDialog
        kind={prompt}
        value={promptValue}
        onChange={setPromptValue}
        onSubmit={submitPrompt}
        onClose={() => setPrompt(null)}
      />
      <DiscardChangesDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        onConfirm={() =>
          onSendInstruction(
            "Discard ALL uncommitted changes in the working tree (staged and unstaged) and remove untracked files. This is destructive; do exactly this and nothing more."
          )
        }
      />
    </header>
  );
}

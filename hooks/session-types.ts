import type { PaneType, PreviewPaneTab, TreeNode } from "./use-split-panes";
import type { Repo } from "@/lib/types";

export const SESSION_COLORS = [
  "green",
  "blue",
  "amber",
  "violet",
  "cyan",
  "rose",
  "orange",
  "teal",
] as const;

export type SessionColor = (typeof SESSION_COLORS)[number];

export type Session = {
  externalRunId?: string;
  id: string;
  index: number;
  name: string;
  color: SessionColor;
  paneTree: TreeNode;
  activeId: string;
  activeRepoId?: string;
  activeRepo?: Repo | null;
  activeSandboxId?: string | null;
  pendingSandboxBranch?: string | null;
};

export type WorkspaceSessionOptions = {
  previewTab?: PreviewPaneTab;
  focusPaneType?: PaneType;
  sandboxId?: string | null;
  pendingSandboxBranch?: string | null;
};

export type SessionsState = {
  sessions: Session[];
  activeSessionId: string;
  createSession: (name?: string) => void;
  createWorkspaceSession: (
    repo: Repo,
    tree: TreeNode,
    options?: WorkspaceSessionOptions
  ) => string;
  openWorkspaceSession: (
    repo: Repo,
    options?: WorkspaceSessionOptions
  ) => string;
  setPendingSessionSandboxBranch: (
    pendingSandboxBranch: string | null,
    options?: { sessionId?: string | null }
  ) => void;
  setActiveSessionSandbox: (
    sandboxId: string | null,
    options?: {
      previousSandboxId?: string | null;
      replacePaneSandboxIds?: boolean;
      sessionId?: string | null;
    }
  ) => void;
  closeSession: (id: string) => void;
  switchSession: (id: string) => void;
  renameSession: (id: string, name: string) => void;
  resetSessionLayout: (id: string) => void;
  updatePaneTree: (
    tree: TreeNode,
    activeId: string,
    options?: { sessionId?: string }
  ) => void;
  getActiveSession: () => Session;
};

export type PersistedSessionsState = {
  sessions: Session[];
  activeSessionId: string;
};

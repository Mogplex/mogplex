import type {
  Agent,
  Assignment,
  Repo,
  SandboxRecord,
  Workspace,
} from "@/lib/types";
import type {
  presentGithubSetup,
  presentVercelSetup,
} from "@/lib/activation/setup-state";

export interface RepoDashboardProps {
  onOpenChat: (repo: Repo) => void;
  onReposLoaded?: (repos: Repo[], agents: Agent[]) => void;
}

export type GithubSetupState = ReturnType<typeof presentGithubSetup>;

export type VercelSetupState = ReturnType<typeof presentVercelSetup>;

export type WorkspaceSection = {
  workspace: Workspace;
  repos: Repo[];
};

export type WorkspaceSectionPanelProps = {
  connectGithubLabel: string;
  getRepoSandbox: (repoId: string) => SandboxRecord | null;
  githubSetup: GithubSetupState;
  isCreatingRepo: (repoId: string) => boolean;
  onBrowseMonorepo: (repo: Repo) => void;
  onCreateRepoWorkspace: (workspace: Workspace) => void;
  onDeleteWorkspace: (workspace: Workspace) => void;
  onEditRepo: (repo: Repo) => void;
  onEditWorkspace: (workspace: Workspace) => void;
  onHideRepo: (repo: Repo) => void;
  onLaunchSandbox: (repo: Repo) => void;
  onOpenChat: (repo: Repo) => void;
  onSelectRepo: (repoId: string) => void;
  onStopSandbox: (repoId: string) => void;
  onToggleFavorite: (repo: Repo) => void;
  repoAgentsMap: Map<string, Agent[]>;
  repoCronsMap: Map<string, Assignment[]>;
  section: WorkspaceSection;
  selectedRepoId: string | null;
  viewMode: "grid" | "list";
};

export interface RepoCardProps {
  repo: Repo;
  sandbox: SandboxRecord | null;
  isCreating: boolean;
  agents: Agent[];
  crons: Assignment[];
  selected: boolean;
  viewMode: "grid" | "list";
  onSelect: () => void;
  onToggleFavorite: () => void;
  onOpenChat: () => void;
  onLaunchSandbox: () => void;
  onStopSandbox: () => void;
  onSettings: () => void;
  onBrowseMonorepo?: () => void;
  onHide: () => void;
}

export type RepoCardMenuItemsProps = {
  repo: Repo;
  isSandboxRunning: boolean;
  isSandboxBusy: boolean;
  onOpenChat: () => void;
  onLaunchSandbox: () => void;
  onStopSandbox: () => void;
  onSettings: () => void;
  onBrowseMonorepo?: () => void;
  onToggleFavorite: () => void;
  onHide: () => void;
  ItemComponent: React.ComponentType<{
    onSelect?: () => void;
    variant?: "default" | "destructive";
    disabled?: boolean;
    children: React.ReactNode;
  }>;
  SeparatorComponent: React.ComponentType;
};

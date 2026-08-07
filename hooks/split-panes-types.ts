export type PaneType =
  | "home"
  | "agent"
  | "tools"
  | "memories"
  | "rules"
  | "skills"
  | "terminal"
  | "editor"
  | "stats"
  | "files"
  | "preview"
  | "roster"
  | "output"
  | "cron"
  | "diff"
  | "triggers"
  | "connections";

export type SplitDir = "horizontal" | "vertical";
export type PreviewPaneTab = "preview" | "code" | "health";
export type PaneSandboxBinding = "session" | "pinned";

export type PaneNode = {
  id: string;
  type: PaneType;
  name: string;
  lines: string[];
  status: "idle" | "running" | "done";
  sandboxBinding?: PaneSandboxBinding;
  sandboxId?: string;
  sandboxVid?: string;
  terminalSessionKey?: string;
  filePath?: string;
  previewTab?: PreviewPaneTab;
};

export type FilePathMutationScope = {
  targetSandboxId?: string | null;
  activeSessionSandboxId?: string | null;
};

export type TerminalSessionSummary = {
  terminalSessionKey: string;
  name: string;
  paneIds: string[];
  sandboxBinding?: PaneSandboxBinding;
  sandboxId?: string;
};

export type SplitNode = {
  id: string;
  dir: SplitDir;
  children: (PaneNode | SplitNode)[];
  sizes: number[];
};

export type TreeNode = PaneNode | SplitNode;

export type MovePosition = "left" | "right" | "top" | "bottom" | "swap";

export function isPane(n: TreeNode): n is PaneNode {
  return "type" in n;
}

export function collectPaneIds(node: TreeNode): string[] {
  if (isPane(node)) return [node.id];
  return node.children.flatMap(collectPaneIds);
}

export function collectPanes(node: TreeNode): PaneNode[] {
  if (isPane(node)) return [node];
  return node.children.flatMap(collectPanes);
}

export const DEFAULT_PANE_NAMES: Record<PaneType, string> = {
  home: "Workspace Guide",
  agent: "Agent Chat",
  tools: "Tools",
  memories: "Context",
  rules: "Rules",
  skills: "Skills",
  terminal: "Terminal",
  editor: "Code Editor",
  stats: "Stats",
  files: "Project Files",
  preview: "Live Preview",
  roster: "Agents",
  output: "Output",
  cron: "Scheduled Runs",
  diff: "Diff",
  triggers: "Workflows",
  connections: "Connections",
};

export const SESSION_BOUND_PANE_TYPES = new Set<PaneType>([
  "agent",
  "terminal",
  "editor",
  "files",
  "preview",
]);

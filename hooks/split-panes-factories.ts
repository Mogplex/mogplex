import {
  collectPanes,
  DEFAULT_PANE_NAMES,
  SESSION_BOUND_PANE_TYPES,
  type PaneNode,
  type PaneSandboxBinding,
  type PaneType,
  type PreviewPaneTab,
  type TreeNode,
} from "./split-panes-types";

export function getPaneSandboxBinding(
  pane:
    | Pick<PaneNode, "type" | "sandboxBinding">
    | { type: PaneType; sandboxBinding?: PaneSandboxBinding }
): PaneSandboxBinding | undefined {
  if (pane.sandboxBinding) return pane.sandboxBinding;
  return SESSION_BOUND_PANE_TYPES.has(pane.type) ? "session" : undefined;
}

function buildDefaultPaneName(node: TreeNode, type: PaneType) {
  if (type !== "terminal") {
    return DEFAULT_PANE_NAMES[type];
  }

  const existingTerminalCount = collectPanes(node).filter(
    (pane) => pane.type === "terminal"
  ).length;
  return existingTerminalCount === 0
    ? DEFAULT_PANE_NAMES.terminal
    : `${DEFAULT_PANE_NAMES.terminal} ${existingTerminalCount + 1}`;
}

export function createPaneNode(
  node: TreeNode,
  id: string,
  type: PaneType,
  overrides: Partial<PaneNode> = {}
): PaneNode {
  const pane: PaneNode = {
    id,
    type,
    name: overrides.name ?? buildDefaultPaneName(node, type),
    lines: [],
    status: "idle",
    sandboxBinding: overrides.sandboxBinding ?? getPaneSandboxBinding({ type }),
    ...overrides,
  };

  if (type === "terminal") {
    pane.terminalSessionKey = overrides.terminalSessionKey ?? id;
  }

  return pane;
}

export function getTerminalSessionKey(
  pane:
    | Pick<PaneNode, "id" | "type" | "terminalSessionKey">
    | { id: string; type: PaneType; terminalSessionKey?: string }
) {
  return pane.terminalSessionKey ?? pane.id;
}

export function createTerminalSessionKey() {
  return `terminal-${crypto.randomUUID().slice(0, 8)}`;
}

export function createDefaultTree(): TreeNode {
  return {
    id: "p-home",
    type: "home",
    name: DEFAULT_PANE_NAMES.home,
    lines: [],
    status: "idle",
  };
}

export function createWorkspaceTree(
  repoName?: string,
  rootDirectory?: string | null,
  options?: { previewTab?: PreviewPaneTab; sandboxId?: string | null }
): TreeNode {
  const repoShort = repoName
    ? repoName.split("/").pop() || repoName
    : "workspace";
  const label = rootDirectory
    ? `${repoShort}:${rootDirectory.split("/").pop()}`
    : repoShort;
  const uid = crypto.randomUUID().slice(0, 8);
  const terminalPaneId = `p-terminal-${uid}`;
  return {
    id: `s-root-${uid}`,
    dir: "horizontal",
    sizes: [35, 65],
    children: [
      {
        id: `p-agent-${uid}`,
        type: "agent",
        name: `Workspace Chat · ${label}`,
        lines: [],
        status: "idle",
        sandboxBinding: "session",
      },
      {
        id: `s-right-${uid}`,
        dir: "vertical",
        sizes: [65, 35],
        children: [
          {
            id: `p-preview-${uid}`,
            type: "preview",
            name: DEFAULT_PANE_NAMES.preview,
            lines: [],
            status: "idle",
            previewTab: options?.previewTab,
            sandboxBinding: "session",
          },
          {
            id: terminalPaneId,
            type: "terminal",
            name: DEFAULT_PANE_NAMES.terminal,
            lines: [],
            status: "idle",
            sandboxBinding: "session",
            terminalSessionKey: terminalPaneId,
          },
        ],
      },
    ],
  };
}

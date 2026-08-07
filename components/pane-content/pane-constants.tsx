"use client";
import type { ReactNode } from "react";
import type { PaneNode, PaneType } from "@/hooks/use-split-panes";
import { getPaneSandboxBinding } from "@/hooks/use-split-panes";
import {
  Home,
  ChatBubble,
  Terminal as TerminalIcon,
  EditPencil,
  Eye,
  Folder,
  Activity,
  Brain,
  Cube,
  Play,
  Timer,
  GitCompare,
  Flash,
  Network,
  ListSelect,
  Sparks,
  Settings,
} from "iconoir-react";

export const ICON_CLASS = "size-3.5";

export const PANE_ICONS: Record<string, ReactNode> = {
  home: <Home className={ICON_CLASS} />,
  agent: <ChatBubble className={ICON_CLASS} />,
  terminal: <TerminalIcon className={ICON_CLASS} />,
  editor: <EditPencil className={ICON_CLASS} />,
  tools: <Settings className={ICON_CLASS} />,
  stats: <Activity className={ICON_CLASS} />,
  memories: <Brain className={ICON_CLASS} />,
  rules: <ListSelect className={ICON_CLASS} />,
  skills: <Sparks className={ICON_CLASS} />,
  files: <Folder className={ICON_CLASS} />,
  preview: <Eye className={ICON_CLASS} />,
  roster: <Cube className={ICON_CLASS} />,
  output: <Play className={ICON_CLASS} />,
  cron: <Timer className={ICON_CLASS} />,
  diff: <GitCompare className={ICON_CLASS} />,
  triggers: <Flash className={ICON_CLASS} />,
  connections: <Network className={ICON_CLASS} />,
};

export const PANE_TYPE_GROUPS: {
  label: string;
  items: { type: PaneType; icon: ReactNode; name: string }[];
}[] = [
  {
    label: "Workspace",
    items: [
      {
        type: "agent",
        icon: <ChatBubble className={ICON_CLASS} />,
        name: "Agent Chat",
      },
      {
        type: "terminal",
        icon: <TerminalIcon className={ICON_CLASS} />,
        name: "Terminal",
      },
      {
        type: "editor",
        icon: <EditPencil className={ICON_CLASS} />,
        name: "Editor",
      },
      {
        type: "preview",
        icon: <Eye className={ICON_CLASS} />,
        name: "Preview",
      },
      { type: "files", icon: <Folder className={ICON_CLASS} />, name: "Files" },
    ],
  },
  {
    label: "System",
    items: [
      {
        type: "stats",
        icon: <Activity className={ICON_CLASS} />,
        name: "Stats",
      },
      {
        type: "memories",
        icon: <Brain className={ICON_CLASS} />,
        name: "Memories",
      },
      { type: "roster", icon: <Cube className={ICON_CLASS} />, name: "Agents" },
      { type: "output", icon: <Play className={ICON_CLASS} />, name: "Output" },
      { type: "cron", icon: <Timer className={ICON_CLASS} />, name: "Cron" },
      {
        type: "diff",
        icon: <GitCompare className={ICON_CLASS} />,
        name: "Diff",
      },
      {
        type: "triggers",
        icon: <Flash className={ICON_CLASS} />,
        name: "Workflows",
      },
      {
        type: "connections",
        icon: <Network className={ICON_CLASS} />,
        name: "Connections",
      },
    ],
  },
];

export function buildSplitSandboxOverrides(
  pane: PaneNode,
  resolvedSandboxId?: string
): Partial<PaneNode> | undefined {
  const sandboxBinding = getPaneSandboxBinding(pane);
  if (sandboxBinding === "pinned") {
    return {
      sandboxBinding: "pinned",
      ...(resolvedSandboxId ? { sandboxId: resolvedSandboxId } : {}),
    };
  }

  if (pane.sandboxBinding === "session") {
    return { sandboxBinding: "session" };
  }

  return undefined;
}

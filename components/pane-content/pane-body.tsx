"use client";
import type { PaneNode } from "@/hooks/use-split-panes";
import type { SandboxError } from "@/lib/sandbox/error-state";
import type { Repo } from "@/lib/types";
import dynamic from "next/dynamic";
import { AgentPane } from "./agent-pane";
import { ToolsPane } from "./tools-pane";
import { MemoriesPane } from "./memories-pane";
import { SandboxPendingOverlay } from "./sandbox-overlay";

const HomePane = dynamic(
  () => import("../panes/home-pane").then((m) => m.HomePane),
  { ssr: false }
);
const AgentRosterPane = dynamic(
  () => import("../panes/agent-roster-pane").then((m) => m.AgentRosterPane),
  { ssr: false }
);
const OutputPane = dynamic(
  () => import("../panes/output-pane").then((m) => m.OutputPane),
  { ssr: false }
);
const CronPane = dynamic(
  () => import("../panes/cron-pane").then((m) => m.CronPane),
  { ssr: false }
);
const DiffPane = dynamic(
  () => import("../panes/diff-pane").then((m) => m.DiffPane),
  { ssr: false }
);
const FlowsPane = dynamic(
  () => import("../panes/flows-pane").then((m) => m.FlowsPane),
  { ssr: false }
);
const ConnectionsPane = dynamic(
  () => import("../panes/connections-pane").then((m) => m.ConnectionsPane),
  { ssr: false }
);
const XTermPane = dynamic(
  () => import("../xterm-pane").then((m) => m.XTermPane),
  { ssr: false }
);
const MonacoPane = dynamic(
  () => import("../monaco-pane").then((m) => m.MonacoPane),
  { ssr: false }
);
const FileManagerPane = dynamic(
  () => import("../file-manager-pane").then((m) => m.FileManagerPane),
  { ssr: false }
);
const SkillsPane = dynamic(
  () => import("../skills-pane").then((m) => m.SkillsPane),
  { ssr: false }
);
const ObservabilityPane = dynamic(
  () => import("../observability-pane").then((m) => m.ObservabilityPane),
  { ssr: false }
);
const FileTreePane = dynamic(
  () => import("../file-tree-pane").then((m) => m.FileTreePane),
  { ssr: false }
);
const PreviewPane = dynamic(
  () => import("../preview-pane").then((m) => m.PreviewPane),
  { ssr: false }
);

interface PaneBodyProps {
  pane: PaneNode;
  repoPath?: string;
  activeRepo?:
    | (Pick<Repo, "id" | "full_name" | "root_directory" | "default_branch"> & {
        working_branch?: string | null;
      })
    | null;
  resolvedSandbox?: { id: string } | null;
  resolvedSandboxId?: string;
  resolvedPreviewUrl?: string;
  sandboxCreating?: boolean;
  sandboxError?: SandboxError | null;
  effectivePathForActiveSandbox: string | null;
  pendingSandboxBranch: string | null;
  currentWorkspaceSessionId: string | null;
  onStreamingChange: (s: boolean) => void;
  onOpenFile?: (filePath: string, sandboxId?: string) => void;
  onRetargetFilePath?: (
    fromPath: string,
    toPath: string,
    sandboxId: string
  ) => void;
  onClearFilePath?: (targetPath: string, sandboxId: string) => void;
  onUpdatePane?: (updates: Partial<PaneNode>) => void;
  onPopOutIDE?: (filePath?: string) => void;
}

export function PaneBody({
  pane,
  repoPath,
  activeRepo,
  resolvedSandbox,
  resolvedSandboxId,
  resolvedPreviewUrl,
  sandboxCreating,
  sandboxError,
  effectivePathForActiveSandbox,
  pendingSandboxBranch,
  currentWorkspaceSessionId,
  onStreamingChange,
  onOpenFile,
  onRetargetFilePath,
  onClearFilePath,
  onUpdatePane,
  onPopOutIDE,
}: PaneBodyProps) {
  switch (pane.type) {
    case "home":
      return <HomePane />;

    case "agent":
      return (
        <AgentPane
          pane={pane}
          repoPath={repoPath}
          activeRepo={activeRepo}
          activeSandbox={resolvedSandbox}
          onStreamingChange={onStreamingChange}
          onUpdatePane={onUpdatePane}
        />
      );

    case "terminal":
      return (
        <div className="flex-1 overflow-hidden">
          <XTermPane
            paneId={pane.id}
            sandboxId={resolvedSandboxId}
            repoId={activeRepo?.id}
            workingBranch={!resolvedSandboxId ? pendingSandboxBranch : null}
            terminalSessionKey={pane.terminalSessionKey ?? pane.id}
          />
        </div>
      );

    case "editor":
      return pane.filePath ? (
        <div className="flex-1 overflow-hidden">
          <MonacoPane
            language="typescript"
            sandboxId={resolvedSandboxId}
            filePath={pane.filePath}
          />
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center px-4 text-center">
          {!resolvedSandboxId && (sandboxCreating || sandboxError) ? (
            <SandboxPendingOverlay
              creating={sandboxCreating}
              error={sandboxError}
              paneType="editor"
            />
          ) : (
            <span className="text-muted-foreground text-sm">
              Open a file from Project Files
              {effectivePathForActiveSandbox
                ? ` under ${effectivePathForActiveSandbox}`
                : ""}{" "}
              to start editing.
            </span>
          )}
        </div>
      );

    case "tools":
      return <ToolsPane />;

    case "stats":
      return <ObservabilityPane />;

    case "memories":
      return (
        <MemoriesPane
          repoId={activeRepo?.id ?? null}
          repoName={activeRepo?.full_name ?? null}
          workspaceSessionId={currentWorkspaceSessionId}
        />
      );

    case "rules":
      return <FileManagerPane type="rules" />;

    case "skills":
      return <SkillsPane />;

    case "files":
      return resolvedSandboxId ? (
        <div className="flex-1 overflow-hidden">
          <FileTreePane
            sandboxId={resolvedSandboxId}
            rootLabel={effectivePathForActiveSandbox || "/"}
            onOpenFile={(filePath) => onOpenFile?.(filePath, resolvedSandboxId)}
            onRetargetFilePath={onRetargetFilePath}
            onClearFilePath={onClearFilePath}
          />
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center px-4 text-center">
          <SandboxPendingOverlay
            creating={sandboxCreating}
            error={sandboxError}
            paneType="files"
          />
          {!sandboxCreating && !sandboxError && (
            <span className="text-muted-foreground text-sm">
              Start Preview for the selected repo to browse project files.
            </span>
          )}
        </div>
      );

    case "preview":
      return (
        <div className="flex-1 overflow-hidden">
          <PreviewPane
            previewUrl={resolvedPreviewUrl}
            sandboxRecordId={resolvedSandboxId}
            sandboxCreating={sandboxCreating}
            sandboxError={sandboxError}
            sandboxId={resolvedSandboxId}
            workingBranch={!resolvedSandboxId ? pendingSandboxBranch : null}
            rootLabel={effectivePathForActiveSandbox || undefined}
            activeRepo={activeRepo}
            initialTab={pane.previewTab}
            activeFilePath={pane.filePath ?? null}
            onActiveFileChange={(filePath) =>
              onUpdatePane?.({ filePath: filePath ?? undefined })
            }
            onRetargetFilePath={onRetargetFilePath}
            onClearFilePath={onClearFilePath}
            onTabChange={(tab) => onUpdatePane?.({ previewTab: tab })}
            onPopOut={onPopOutIDE}
          />
        </div>
      );

    case "roster":
      return <AgentRosterPane />;

    case "output":
      return <OutputPane />;

    case "cron":
      return <CronPane />;

    case "diff":
      return <DiffPane />;

    case "triggers":
      return <FlowsPane />;

    case "connections":
      return <ConnectionsPane />;

    default:
      return null;
  }
}

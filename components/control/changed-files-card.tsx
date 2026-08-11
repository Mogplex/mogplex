"use client";

import { useMemo, useState } from "react";
import type { UIMessage } from "ai";
import {
  Folder,
  NavArrowDown,
  NavArrowRight,
  Page,
} from "iconoir-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { PatchViewer } from "@/components/diffs/patch-viewer";
import {
  buildChangedFileTree,
  collectChangedFiles,
  collectDirPaths,
  type ChangedDirNode,
  type ChangedFile,
} from "@/lib/control/changed-files";

function ChangeCounts({
  additions,
  deletions,
}: {
  additions: number;
  deletions: number;
}) {
  return (
    <span className="ml-auto shrink-0 font-mono text-[12px]">
      <span className="text-addg">+{additions}</span>
      <span className="text-ink-600"> / </span>
      <span className="text-delr">−{deletions}</span>
    </span>
  );
}

function FileRow({ file, depth }: { file: ChangedFile; depth: number }) {
  const name = file.path.split("/").pop() ?? file.path;
  return (
    <div
      className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-ink-850"
      style={{ paddingLeft: 8 + depth * 20 }}
    >
      <Page className="size-3.5 shrink-0 text-ink-400" strokeWidth={1.8} />
      <span className="min-w-0 truncate text-ink-300" title={file.path}>
        {name}
      </span>
      {file.patch ? (
        <ChangeCounts additions={file.additions} deletions={file.deletions} />
      ) : (
        <span
          className={`ml-auto size-1.5 shrink-0 rounded-full ${
            file.state === "done"
              ? "bg-addg"
              : file.state === "failed"
                ? "bg-delr"
                : "animate-pulse bg-sky-400"
          }`}
        />
      )}
    </div>
  );
}

function DirSection({
  node,
  depth,
  collapsedDirs,
  onToggleDir,
}: {
  node: ChangedDirNode;
  depth: number;
  collapsedDirs: ReadonlySet<string>;
  onToggleDir: (path: string) => void;
}) {
  const isCollapsed = collapsedDirs.has(node.path);
  return (
    <div>
      <button
        type="button"
        onClick={() => onToggleDir(node.path)}
        style={{ paddingLeft: 8 + depth * 20 }}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-ink-850"
      >
        {isCollapsed ? (
          <NavArrowRight className="size-3 shrink-0 text-ink-400" />
        ) : (
          <NavArrowDown className="size-3 shrink-0 text-ink-400" />
        )}
        <Folder className="size-3.5 shrink-0 text-ink-400" strokeWidth={1.8} />
        <span className="min-w-0 truncate text-ink-200">{node.name}</span>
        <ChangeCounts additions={node.additions} deletions={node.deletions} />
      </button>
      {isCollapsed ? null : (
        <>
          {node.dirs.map((dir) => (
            <DirSection
              key={dir.path}
              node={dir}
              depth={depth + 1}
              collapsedDirs={collapsedDirs}
              onToggleDir={onToggleDir}
            />
          ))}
          {node.files.map((file) => (
            <FileRow key={file.path} file={file} depth={depth + 1} />
          ))}
        </>
      )}
    </div>
  );
}

/**
 * End-of-run summary card in the chat panel: every file the agent touched,
 * grouped by directory, with a combined diff modal backed by PatchViewer.
 * Renders only once the run is complete and real patch data exists.
 */
export function ChangedFilesCard({ messages }: { messages: UIMessage[] }) {
  const files = useMemo(() => collectChangedFiles(messages), [messages]);
  const tree = useMemo(() => buildChangedFileTree(files), [files]);
  const [collapsedDirs, setCollapsedDirs] = useState<ReadonlySet<string>>(
    new Set()
  );
  const [diffOpen, setDiffOpen] = useState(false);

  const allDirPaths = useMemo(() => collectDirPaths(tree), [tree]);
  const allCollapsed =
    allDirPaths.length > 0 && allDirPaths.every((p) => collapsedDirs.has(p));
  const combinedPatch = useMemo(
    () =>
      files
        .map((file) => file.patch)
        .filter(Boolean)
        .join("\n"),
    [files]
  );

  const toggleDir = (path: string) => {
    setCollapsedDirs((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const toggleAll = () => {
    setCollapsedDirs(allCollapsed ? new Set() : new Set(allDirPaths));
  };

  return (
    <div className="overflow-hidden rounded-xl border border-ink-800 bg-ink-900">
      <div className="flex flex-wrap items-center gap-3 border-b border-ink-800 px-5 py-3">
        <span className="text-[12px] font-semibold tracking-wider text-ink-300 uppercase">
          Changed files ({files.length})
        </span>
        <span className="font-mono text-[12px]">
          <span className="text-addg">+{tree.additions}</span>{" "}
          <span className="text-ink-600">/</span>{" "}
          <span className="text-delr">−{tree.deletions}</span>
        </span>
        <div className="ml-auto flex items-center gap-2">
          {allDirPaths.length > 0 ? (
            <button
              type="button"
              onClick={toggleAll}
              className="rounded-md border border-ink-700 bg-ink-850 px-3 py-1.5 text-[12.5px] font-medium text-ink-200 transition-colors hover:bg-ink-800"
            >
              {allCollapsed ? "Expand all" : "Collapse all"}
            </button>
          ) : null}
          {combinedPatch ? (
            <button
              type="button"
              onClick={() => setDiffOpen(true)}
              className="rounded-md border border-ink-700 bg-ink-850 px-3 py-1.5 text-[12.5px] font-medium text-ink-200 transition-colors hover:bg-ink-800"
            >
              View diff
            </button>
          ) : null}
        </div>
      </div>
      <div className="px-3 py-2 font-mono text-[13px]">
        {tree.dirs.map((dir) => (
          <DirSection
            key={dir.path}
            node={dir}
            depth={0}
            collapsedDirs={collapsedDirs}
            onToggleDir={toggleDir}
          />
        ))}
        {tree.files.map((file) => (
          <FileRow key={file.path} file={file} depth={0} />
        ))}
      </div>

      <Dialog open={diffOpen} onOpenChange={setDiffOpen}>
        <DialogContent className="flex h-[85dvh] w-[90dvw] max-w-[90dvw] flex-col gap-0 overflow-hidden rounded-xl border-ink-700 bg-ink-900 p-0">
          <div className="flex items-center gap-2 border-b border-ink-800 px-4 py-2.5">
            <DialogTitle className="text-[13px] font-semibold text-ink-100">
              Diff · {files.length} file{files.length === 1 ? "" : "s"}
            </DialogTitle>
            <span className="font-mono text-[12px]">
              <span className="text-addg">+{tree.additions}</span>{" "}
              <span className="text-ink-600">/</span>{" "}
              <span className="text-delr">−{tree.deletions}</span>
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <PatchViewer patch={combinedPatch} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

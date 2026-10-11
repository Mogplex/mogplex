"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { NavArrowLeft } from "iconoir-react";
const FileTreePane = dynamic(() => import("@/components/file-tree-pane").then(module => module.FileTreePane), { ssr: false });
const MonacoPane = dynamic(() => import("@/components/monaco-pane").then(module => module.MonacoPane), { ssr: false });

export function TaskFiles({ sandboxId, rootLabel }: { sandboxId: string; rootLabel: string }) {
  const [path, setPath] = useState<string | null>(null);
  return <div className="flex h-full min-h-0 flex-col">
    {path && <div className="flex items-center gap-2 border-b border-border px-3 py-2">
      <button type="button" aria-label="Back to files" onClick={() => setPath(null)} className="rounded p-1 hover:bg-muted"><NavArrowLeft className="size-4" /></button>
      <span className="min-w-0 flex-1 truncate font-mono text-xs" title={path}>{path}</span><span className="shrink-0 text-xs text-muted-foreground">Read only</span>
    </div>}
    <div className={path ? "hidden" : "min-h-0 flex-1"}>
      <FileTreePane sandboxId={sandboxId} rootLabel={rootLabel} activeFilePath={path} onOpenFile={setPath}
        onRetargetFilePath={(from, to) => setPath(current => current === from || current?.startsWith(`${from}/`) ? `${to}${current.slice(from.length)}` : current)}
        onClearFilePath={target => setPath(current => current === target || current?.startsWith(`${target}/`) ? null : current)} />
    </div>
    {path && <div className="min-h-0 flex-1"><MonacoPane key={path} sandboxId={sandboxId} filePath={path} readOnly /></div>}
  </div>;
}

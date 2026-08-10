"use client";

import { useMemo, useState } from "react";
import type { UIMessage } from "ai";
import {
  Artifact,
  ArtifactClose,
  ArtifactContent,
  ArtifactDescription,
  ArtifactHeader,
  ArtifactTitle,
} from "@/components/ai-elements/artifact";
import { MessageResponse } from "@/components/ai-elements/message";
import { usePanelWidth } from "@/hooks/use-panel-width";
import { collectControlArtifacts } from "./artifact-side-panel-model";

const WIDTH_KEY = "mogplex.artifactPanel.width";
const DEFAULT_WIDTH = 360;
const MIN_WIDTH = 280;
const MAX_WIDTH = 560;

const SAFE_ARTIFACT_URL_PROTOCOLS = new Set([
  "http:",
  "https:",
  "data:",
  "blob:",
]);

function getSafeArtifactUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url, "https://mogplex.local/");
    if (!SAFE_ARTIFACT_URL_PROTOCOLS.has(parsed.protocol)) return null;
    return url;
  } catch {
    return null;
  }
}

export function ArtifactSidePanel({ messages }: { messages: UIMessage[] }) {
  const artifacts = useMemo(
    () => collectControlArtifacts(messages),
    [messages]
  );
  const [closedArtifactKey, setClosedArtifactKey] = useState<string | null>(
    null
  );
  const { width, resizing, panelRef, resizerProps } = usePanelWidth({
    storageKey: WIDTH_KEY,
    defaultWidth: DEFAULT_WIDTH,
    minWidth: MIN_WIDTH,
    maxWidth: MAX_WIDTH,
    handle: "left",
  });
  const artifactKey = artifacts.map((artifact) => artifact.id).join("|");
  const closed = artifactKey !== "" && closedArtifactKey === artifactKey;

  if (artifacts.length === 0 || closed) return null;

  return (
    <aside
      ref={panelRef}
      className="border-border bg-card relative flex shrink-0 flex-col border-l"
      style={{ width }}
      data-resizing={resizing ? "true" : "false"}
      aria-label="Artifacts"
    >
      <div
        {...resizerProps}
        aria-label="Resize artifacts panel"
        className="app-panel-resizer app-panel-resizer-left absolute inset-y-0 left-0 z-30 w-2 cursor-col-resize touch-none outline-none"
      />
      <div className="border-border flex items-center justify-between border-b px-3 py-2">
        <div>
          <h2 className="text-sm font-semibold">Artifacts</h2>
          <p className="text-muted-foreground text-[11px]">
            {artifacts.length} item{artifacts.length === 1 ? "" : "s"}
          </p>
        </div>
        <ArtifactClose onClick={() => setClosedArtifactKey(artifactKey)} />
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {artifacts.map((artifact) => {
          const safeFileUrl = getSafeArtifactUrl(artifact.file?.url);
          return (
            <Artifact key={artifact.id} className="rounded-md shadow-none">
              <ArtifactHeader className="px-3 py-2">
                <div className="min-w-0">
                  <ArtifactTitle className="truncate">
                    {artifact.title}
                  </ArtifactTitle>
                  <ArtifactDescription className="text-xs">
                    {artifact.description}
                  </ArtifactDescription>
                </div>
              </ArtifactHeader>
              <ArtifactContent className="max-h-[440px] p-3">
                {artifact.kind === "document" ? (
                  <MessageResponse className="text-sm leading-6">
                    {artifact.body ?? ""}
                  </MessageResponse>
                ) : artifact.file?.mediaType.startsWith("image/") &&
                  safeFileUrl ? (
                  <img
                    src={safeFileUrl}
                    alt={artifact.file.filename ?? artifact.file.mediaType}
                    className="border-border max-h-80 w-full rounded border object-contain"
                  />
                ) : safeFileUrl ? (
                  <a
                    href={safeFileUrl}
                    download={artifact.file?.filename}
                    className="text-primary text-sm underline-offset-4 hover:underline"
                  >
                    Open {artifact.file?.filename ?? "file"}
                  </a>
                ) : (
                  <span className="text-muted-foreground text-sm">
                    {artifact.file?.filename ?? "File unavailable"}
                  </span>
                )}
              </ArtifactContent>
            </Artifact>
          );
        })}
      </div>
    </aside>
  );
}

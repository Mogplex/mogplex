"use client";

import { useMemo } from "react";
import type { UIMessage } from "ai";
import {
  Artifact,
  ArtifactContent,
  ArtifactDescription,
  ArtifactHeader,
  ArtifactTitle,
} from "@/components/ai-elements/artifact";
import { collectControlArtifacts } from "./artifact-side-panel-model";

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
  const artifacts = useMemo(() => collectControlArtifacts(messages), [messages]);
  if (artifacts.length === 0) return null;
  return (<div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
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
                {artifact.file?.mediaType.startsWith("image/") &&
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
  );
}

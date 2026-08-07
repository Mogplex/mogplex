"use client";
import dynamic from "next/dynamic";

const ContextSection = dynamic(
  () =>
    import("@/components/library/context-section").then(
      (m) => m.ContextSection
    ),
  { ssr: false }
);

export function MemoriesPane({
  repoId,
  repoName,
  workspaceSessionId,
}: {
  repoId?: string | null;
  repoName?: string | null;
  workspaceSessionId?: string | null;
}) {
  return (
    <ContextSection
      compact
      repoId={repoId}
      repoName={repoName}
      workspaceSessionId={workspaceSessionId}
    />
  );
}

"use client";
import { useSandboxStore } from "@/hooks/use-sandbox";
import { resolveSandboxUiState, type SandboxUiState } from "@/lib/sandbox/ui-state";
import { SandboxChip } from "@/components/sandbox-chip";

/**
 * Subtle monospaced tag advertising the workspace path the sandbox is
 * actually running at. Renders only when the path is a non-empty string -
 * `null` (explicit repo root) and missing/legacy values are hidden so the
 * pane title bar stays clean for the common case (whole-repo sandboxes).
 *
 * The `:` prefix matches the established repo-card convention
 * (components/repo-dashboard.tsx) so users see one path-display idiom.
 */
export function SandboxPathTag({ path }: { path: string | null }) {
  if (!path) return null;
  const lastSegment = path.split("/").filter(Boolean).pop() ?? path;
  return (
    <span
      className="text-muted-foreground hidden font-mono text-[11px] sm:inline"
      title={`Sandbox path: ${path}`}
    >
      :{lastSegment}
    </span>
  );
}

export function SandboxIndicator({
  sandbox,
  creating,
}: {
  sandbox?: { id: string } | null;
  creating?: boolean;
}) {
  const sandboxRecord = useSandboxStore((s) => {
    if (!sandbox) return null;
    return s.getSandboxById(sandbox.id);
  });
  const sandboxUiState = resolveSandboxUiState({
    session: null,
    record: sandboxRecord,
  });

  if (creating) {
    const creatingState: SandboxUiState = {
      kind: "booting",
      sandboxId: sandbox?.id ?? "pending",
      phase: "creating",
    };
    return <SandboxChip state={creatingState} />;
  }

  return <SandboxChip state={sandboxUiState} />;
}

export function PaneBadge({ status }: { status?: string }) {
  if (!status || status === "idle") return null;
  const isLive = status === "running" || status === "streaming";
  const isError = status === "error";
  return (
    <span
      className={`rounded-[3px] border px-2 py-0.5 font-mono text-[11px] ${
        isLive
          ? "text-accent-green border-accent-green/20 bg-accent-green/[0.06]"
          : isError
            ? "text-accent-red border-accent-red/20 bg-accent-red/[0.06]"
            : "text-muted-foreground border-border-dim bg-background"
      }`}
    >
      {status}
    </span>
  );
}

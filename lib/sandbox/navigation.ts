import type { PaneType, PreviewPaneTab } from "@/hooks/use-split-panes";
import type { Repo } from "@/lib/types";
import { scopedHref } from "@/lib/scoped-href";

type RouterLike = {
  push: (href: string) => void;
};

type WorkspaceSessionOpener = (
  repo: Repo,
  options?: {
    previewTab?: PreviewPaneTab;
    focusPaneType?: PaneType;
    sandboxId?: string | null;
  }
) => string;

export function buildSandboxObservabilityHref(input: {
  scope: string;
  repoId: string;
  sandboxRecordId?: string | null;
}) {
  const params = new URLSearchParams();
  params.set("repo_id", input.repoId);
  if (input.sandboxRecordId) {
    params.set("sandbox_record_id", input.sandboxRecordId);
  }
  return scopedHref(input.scope, `/observability?${params.toString()}`);
}

export function navigateToSandboxHealth(input: {
  scope: string;
  repoId?: string | null;
  sandboxRecordId?: string | null;
  repos: Repo[];
  openWorkspaceSession: WorkspaceSessionOpener;
  router: RouterLike;
}) {
  if (!input.repoId) return false;

  const repo = input.repos.find((candidate) => candidate.id === input.repoId);
  if (!repo) return false;

  input.openWorkspaceSession(repo, {
    previewTab: "health",
    focusPaneType: "preview",
    ...(input.sandboxRecordId ? { sandboxId: input.sandboxRecordId } : {}),
  });
  input.router.push(scopedHref(input.scope, "/projects/workspace"));
  return true;
}

import type { MemoryScope } from "@/lib/memories-client";
import { getOwnedRepo, getRepoForScope } from "@/lib/repos";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { ProductResourceScope } from "@/lib/team-resource-scope";

type OwnedRepoLoader = typeof getOwnedRepo<{ id: string }>;
type ScopedRepoLoader = typeof getRepoForScope<{ id: string }>;

type OwnedSandboxScopeRecord = {
  id: string;
  repo_id: string | null;
};

type OwnedSandboxLoader = (
  sandboxId: string,
  userId: string
) => Promise<OwnedSandboxScopeRecord | null>;

type MemoryScopeValidationDeps = {
  loadOwnedRepo: OwnedRepoLoader;
  loadRepoForScope?: ScopedRepoLoader;
  loadOwnedSandbox: OwnedSandboxLoader;
};

const defaultMemoryScopeValidationDeps: MemoryScopeValidationDeps = {
  loadOwnedRepo: (repoId, userId) => getOwnedRepo(repoId, userId),
  loadRepoForScope: (repoId, scope) => getRepoForScope(repoId, scope),
  async loadOwnedSandbox(sandboxId, userId) {
    const { data, error } = await supabaseAdmin
      .from("sandboxes")
      .select("id, repo_id")
      .eq("id", sandboxId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to load sandbox ${sandboxId}: ${error.message}`);
    }

    return (data as OwnedSandboxScopeRecord | null) ?? null;
  },
};

export class MemoryScopeValidationError extends Error {
  status: number;

  constructor(message: string, status = 404) {
    super(message);
    this.name = "MemoryScopeValidationError";
    this.status = status;
  }
}

export async function validateOwnedMemoryScope(
  userId: string,
  scope?: MemoryScope,
  deps: MemoryScopeValidationDeps = defaultMemoryScopeValidationDeps,
  options?: { productScope?: ProductResourceScope }
): Promise<MemoryScope | undefined> {
  if (!scope) return undefined;

  if (scope.repoId) {
    const loadRepoForScope =
      deps.loadRepoForScope ??
      ((repoId, productScope) => getRepoForScope(repoId, productScope));
    const repo = options?.productScope
      ? await loadRepoForScope(scope.repoId, options.productScope)
      : await deps.loadOwnedRepo(scope.repoId, userId);
    if (!repo) {
      throw new MemoryScopeValidationError("Repo not found");
    }
  }

  if (scope.sandboxId) {
    const sandbox = await deps.loadOwnedSandbox(scope.sandboxId, userId);
    if (!sandbox) {
      throw new MemoryScopeValidationError("Sandbox not found");
    }
    if (scope.repoId && sandbox.repo_id && sandbox.repo_id !== scope.repoId) {
      throw new MemoryScopeValidationError(
        "Sandbox does not belong to repo",
        400
      );
    }
  }

  return scope;
}

import { getRepoForScope } from "@/lib/repos";
import {
  resolveProductResourceScope,
  type ProductResourceScope,
} from "@/lib/team-resource-scope";
import { parseControlSessionRepoId } from "./session-project";

type RepoAccessResult =
  | { ok: true; value: string | null }
  | { ok: false; status: 400 | 403 | 404 | 500; error: string };

type RepoAccessDeps = {
  resolveProductResourceScope: typeof resolveProductResourceScope;
  getRepoForScope: (
    repoId: string,
    scope: ProductResourceScope,
    select?: string
  ) => Promise<{ id: string } | null>;
};

const DEFAULT_DEPS: RepoAccessDeps = {
  resolveProductResourceScope,
  getRepoForScope,
};

export async function validateControlSessionRepoAccess(
  input: {
    request: Request;
    userId: string;
    repoId: unknown;
  },
  deps: RepoAccessDeps = DEFAULT_DEPS
): Promise<RepoAccessResult> {
  const parsedRepoId = parseControlSessionRepoId(input.repoId);
  if (!parsedRepoId.ok) {
    return { ok: false, status: 400, error: "Invalid repo_id" };
  }
  if (!parsedRepoId.value) return { ok: true, value: null };

  const scopeResolution = await deps.resolveProductResourceScope({
    request: input.request,
    userId: input.userId,
  });
  if (!scopeResolution.ok) return scopeResolution;

  const repo = await deps.getRepoForScope(
    parsedRepoId.value,
    scopeResolution.scope,
    "id"
  );
  if (!repo) {
    return { ok: false, status: 404, error: "Repository not found" };
  }
  return { ok: true, value: parsedRepoId.value };
}

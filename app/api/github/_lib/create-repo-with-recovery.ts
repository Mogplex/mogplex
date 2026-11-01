import {
  type createGithubRepo,
  type fetchGithubRepo,
  GithubRepoCreateError,
  isRecoverableGithubRepoCreateConflict,
} from "@/lib/github-create";
import type { GithubRepoOwnerTarget } from "@/lib/github-owners";

/**
 * Create the repository, adopting it when GitHub reports a name conflict for
 * a repository a previous attempt already created (a double submit, or a retry
 * after the import failed). Any other conflict is rethrown.
 */
export async function createGithubRepoWithRecovery(
  deps: {
    createGithubRepo: typeof createGithubRepo;
    fetchGithubRepo: typeof fetchGithubRepo;
  },
  token: string,
  ownerTarget: GithubRepoOwnerTarget,
  input: Omit<Parameters<typeof createGithubRepo>[1], "owner">
) {
  try {
    return await deps.createGithubRepo(token, {
      ...input,
      owner: ownerTarget.kind === "personal" ? null : ownerTarget.login,
    });
  } catch (error) {
    if (!(error instanceof GithubRepoCreateError) || error.status !== 422) {
      throw error;
    }
    const existingRepo = await deps
      .fetchGithubRepo(token, ownerTarget.login, input.name)
      .catch((lookupError) => {
        console.warn("[github-repo-create] conflict lookup failed", {
          owner: ownerTarget.login,
          name: input.name,
          error: lookupError,
        });
        return null;
      });
    if (!existingRepo || !isRecoverableGithubRepoCreateConflict(existingRepo)) {
      throw error;
    }
    return existingRepo;
  }
}

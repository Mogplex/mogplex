import {
  type createGithubRepo,
  type fetchGithubRepo,
  GithubRepoCreateError,
  isRecoverableGithubRepoCreateConflict,
} from "@/lib/github-create";
import { NextResponse } from "next/server";
import { forgetRejectedGithubAppUserToken } from "@/lib/github-app-user-auth";
import type { GithubRepoOwnerTarget } from "@/lib/github-owners";
import {
  GITHUB_APP_USER_AUTHORIZE_PATH,
  githubRepoCreateErrorResponse,
} from "@/lib/github-repo-create-credential";
import type { upsertGithubReposForUser } from "@/lib/github-sync";

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

type ImportedRepoTarget = {
  ownerTarget: GithubRepoOwnerTarget;
  token: string;
  viaApp: boolean;
};

/**
 * The create pipeline both create routes share once the target is resolved:
 * create (adopting a repo a previous attempt made), import, read it back, and
 * map GitHub's refusals. Keeping it in one place keeps the two routes'
 * contracts from drifting.
 */
export async function createAndImportGithubRepo(input: {
  deps: Parameters<typeof createGithubRepoWithRecovery>[0] & {
    upsertGithubReposForUser: typeof upsertGithubReposForUser;
  };
  userId: string;
  target: ImportedRepoTarget;
  repo: Omit<Parameters<typeof createGithubRepo>[1], "owner">;
  importOptions: Omit<
    NonNullable<Parameters<typeof upsertGithubReposForUser>[2]>,
    "githubInstallationId"
  >;
  loadImported: (githubId: number) => Promise<unknown>;
  logScope: string;
  forgetAppUserToken?: (userId: string, accessToken: string) => Promise<void>;
}): Promise<NextResponse> {
  const forgetAppUserToken =
    input.forgetAppUserToken ?? forgetRejectedGithubAppUserToken;
  const { ownerTarget, token, viaApp } = input.target;
  try {
    const createdRepo = await createGithubRepoWithRecovery(
      input.deps,
      token,
      ownerTarget,
      input.repo
    );
    await input.deps.upsertGithubReposForUser(input.userId, [createdRepo], {
      ...input.importOptions,
      githubInstallationId: ownerTarget.github_installation_id,
    });
    const repo = await input.loadImported(createdRepo.id);
    if (!repo) {
      return NextResponse.json(
        { error: "Created repository was not imported" },
        { status: 500 }
      );
    }
    return NextResponse.json(repo);
  } catch (error) {
    // GitHub rejects a revoked App user token with 401 even before it
    // expires; forget it and ask for authorization again instead of a
    // dead-end error.
    if (
      error instanceof GithubRepoCreateError &&
      error.status === 401 &&
      viaApp &&
      ownerTarget.kind === "personal"
    ) {
      await forgetAppUserToken(input.userId, token).catch((forgetError) => {
        console.warn(`[${input.logScope}] could not forget rejected grant`, {
          userId: input.userId,
          error: forgetError,
        });
      });
      return NextResponse.json(
        {
          code: "GITHUB_APP_USER_AUTHORIZATION_REQUIRED",
          error: `Authorize Mogplex to create repositories in ${ownerTarget.login}, then try again.`,
          authorize_url: GITHUB_APP_USER_AUTHORIZE_PATH,
        },
        { status: 403 }
      );
    }
    if (error instanceof GithubRepoCreateError) {
      const { status, body } = githubRepoCreateErrorResponse(error, {
        ownerLogin: ownerTarget.login,
        viaApp,
      });
      return NextResponse.json(body, { status });
    }
    console.error(`[${input.logScope}] unexpected failure`, {
      userId: input.userId,
      owner: ownerTarget.login,
      name: input.repo.name,
      error,
    });
    return NextResponse.json(
      { error: "Failed to create repository" },
      { status: 500 }
    );
  }
}

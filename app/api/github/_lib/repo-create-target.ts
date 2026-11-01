import { NextResponse } from "next/server";
import { loadGithubRepoCreationOwnerTargets } from "@/app/api/github/_lib/repo-owner-targets";
import {
  GITHUB_ORG_READ_SCOPE,
  GITHUB_REAUTHORIZE_HEADER,
} from "@/lib/github-oauth";
import type { GithubRepoOwnerTarget } from "@/lib/github-owners";
import {
  getGithubRepoCreationUserToken,
  resolveGithubRepoCreateCredential,
} from "@/lib/github-repo-create-credential";

export type RepoCreateTargetDeps = {
  getGithubToken: (userId: string) => Promise<string | null>;
  loadOwnerTargets: (
    userId: string,
    token: string,
    options?: { onlyLogin?: string | null }
  ) => Promise<{
    targets: GithubRepoOwnerTarget[];
    oauthScopes: string[] | null;
    deniedOrgLogins?: string[];
  }>;
  resolveCreateCredential: typeof resolveGithubRepoCreateCredential;
};

export const defaultRepoCreateTargetDeps: RepoCreateTargetDeps = {
  getGithubToken: (userId) => getGithubRepoCreationUserToken(userId),
  loadOwnerTargets: loadGithubRepoCreationOwnerTargets,
  resolveCreateCredential: resolveGithubRepoCreateCredential,
};

type RepoCreateTarget =
  | {
      ok: true;
      ownerTarget: GithubRepoOwnerTarget;
      token: string;
      viaInstallation: boolean;
    }
  | { ok: false; response: NextResponse };

function refuse(
  body: { error: string; code?: string },
  status: number,
  headers?: Record<string, string>
): RepoCreateTarget {
  return { ok: false, response: NextResponse.json(body, { status, headers }) };
}

/**
 * Resolve where a new repository goes and which credential creates it.
 * Owners are revalidated live at the mutation boundary: reusing a
 * client-provided or cached target could create a repository after org
 * permissions changed. A null `ownerLogin` selects the personal account.
 */
export async function resolveRepoCreateTarget(
  userId: string,
  ownerLogin: string | null,
  deps: RepoCreateTargetDeps
): Promise<RepoCreateTarget> {
  let token: string | null;
  try {
    token = await deps.getGithubToken(userId);
  } catch (error) {
    console.error("[github-repo-create] GitHub connection lookup failed", {
      userId,
      error,
    });
    return refuse({ error: "Could not read your GitHub connection" }, 500);
  }
  if (!token) return refuse({ error: "Connect GitHub account first" }, 400);

  let owners: Awaited<ReturnType<RepoCreateTargetDeps["loadOwnerTargets"]>>;
  try {
    owners = await deps.loadOwnerTargets(userId, token, {
      onlyLogin: ownerLogin,
    });
  } catch (error) {
    console.error("[github-repo-create] owner lookup failed", {
      userId,
      error,
    });
    return refuse({ error: "GitHub accounts unavailable" }, 502);
  }
  const ownerTarget = owners.targets.find((target) =>
    ownerLogin === null
      ? target.kind === "personal"
      : target.login.toLowerCase() === ownerLogin.toLowerCase()
  );
  const denied = owners.deniedOrgLogins?.find(
    (login) => login.toLowerCase() === ownerLogin?.toLowerCase()
  );
  if (!ownerTarget && denied) {
    return refuse(
      {
        error: `Your role in ${denied} cannot create repositories through Mogplex. Ask an owner of ${denied}.`,
        code: "GITHUB_ORG_CREATE_NOT_ALLOWED",
      },
      403
    );
  }
  if (!ownerTarget) {
    // Without read:org every organization drops out of the owner list.
    if (
      owners.oauthScopes !== null &&
      !owners.oauthScopes.includes(GITHUB_ORG_READ_SCOPE)
    ) {
      return refuse(
        {
          error: "Reconnect GitHub to use organization accounts.",
          code: "GITHUB_REAUTHORIZE_REQUIRED",
        },
        400,
        { [GITHUB_REAUTHORIZE_HEADER]: GITHUB_ORG_READ_SCOPE }
      );
    }
    return refuse({ error: "Selected GitHub account is unavailable" }, 400);
  }

  const credential = await deps.resolveCreateCredential(ownerTarget, token);
  if (!credential.ok) {
    return refuse(
      { error: credential.error, code: credential.code },
      credential.status
    );
  }
  return {
    ok: true,
    ownerTarget,
    token: credential.token,
    viaInstallation: credential.viaInstallation,
  };
}

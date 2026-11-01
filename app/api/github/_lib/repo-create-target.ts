import { NextResponse } from "next/server";
import { loadGithubAppCreateTarget } from "@/app/api/github/_lib/app-create-target";
import { loadGithubRepoCreationOwnerTargets } from "@/app/api/github/_lib/repo-owner-targets";
import { hasGithubAppConfig } from "@/lib/github-app";
import {
  GITHUB_ORG_READ_SCOPE,
  GITHUB_REAUTHORIZE_HEADER,
} from "@/lib/github-oauth";
import type { GithubRepoOwnerTarget } from "@/lib/github-owners";
import {
  getGithubRepoCreationUserToken,
  resolveGithubRepoCreateCredential,
} from "@/lib/github-repo-create-credential";

type OwnerLookup = {
  target: GithubRepoOwnerTarget | null;
  oauthScopes: string[] | null;
};

export type RepoCreateTargetDeps = {
  appConfigured: () => boolean;
  getGithubToken: (userId: string) => Promise<string | null>;
  /** OAuth deployments: the owner list, filtered by the user's org policy. */
  loadOwnerTargets: (
    userId: string,
    token: string,
    options?: { onlyLogin?: string | null }
  ) => Promise<{
    targets: GithubRepoOwnerTarget[];
    oauthScopes: string[] | null;
  }>;
  /** App deployments: only the named owner; ownership is checked live later. */
  loadAppCreateTarget: typeof loadGithubAppCreateTarget;
  resolveCreateCredential: typeof resolveGithubRepoCreateCredential;
};

export const defaultRepoCreateTargetDeps: RepoCreateTargetDeps = {
  appConfigured: () => hasGithubAppConfig(),
  getGithubToken: (userId) => getGithubRepoCreationUserToken(userId),
  loadOwnerTargets: loadGithubRepoCreationOwnerTargets,
  loadAppCreateTarget: loadGithubAppCreateTarget,
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

async function lookUpOwner(
  userId: string,
  token: string,
  ownerLogin: string | null,
  deps: RepoCreateTargetDeps
): Promise<OwnerLookup> {
  if (deps.appConfigured())
    return deps.loadAppCreateTarget(userId, token, ownerLogin);
  const { targets, oauthScopes } = await deps.loadOwnerTargets(userId, token, {
    onlyLogin: ownerLogin,
  });
  const target =
    targets.find((candidate) =>
      ownerLogin === null
        ? candidate.kind === "personal"
        : candidate.login.toLowerCase() === ownerLogin.toLowerCase()
    ) ?? null;
  return { target, oauthScopes };
}

/** Org ownership is read with read:org; without it the org cannot resolve. */
function needsOrgReadScope(lookup: OwnerLookup) {
  const missing =
    lookup.oauthScopes !== null &&
    !lookup.oauthScopes.includes(GITHUB_ORG_READ_SCOPE);
  return missing && (lookup.target === null || lookup.target.kind === "org");
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

  let lookup: OwnerLookup;
  try {
    lookup = await lookUpOwner(userId, token, ownerLogin, deps);
  } catch (error) {
    console.error("[github-repo-create] owner lookup failed", {
      userId,
      error,
    });
    return refuse({ error: "GitHub accounts unavailable" }, 502);
  }
  if (needsOrgReadScope(lookup)) {
    return refuse(
      {
        error: "Reconnect GitHub to use organization accounts.",
        code: "GITHUB_REAUTHORIZE_REQUIRED",
      },
      400,
      { [GITHUB_REAUTHORIZE_HEADER]: GITHUB_ORG_READ_SCOPE }
    );
  }
  const ownerTarget = lookup.target;
  if (!ownerTarget)
    return refuse({ error: "Selected GitHub account is unavailable" }, 400);

  const credential = await deps.resolveCreateCredential(ownerTarget, token, {
    appConfigured: deps.appConfigured,
  });
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

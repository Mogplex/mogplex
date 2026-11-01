import { expect, it, vi } from "vitest";
import type { GithubRepoOwnerTarget } from "./github-owners";
import { GithubHttpError } from "./github-app";
import { GithubRepoCreateError } from "./github-create";
import {
  getGithubRepoCreationUserToken,
  githubRepoCreateErrorResponse,
  resolveGithubRepoCreateCredential,
} from "./github-repo-create-credential";

const orgTarget: GithubRepoOwnerTarget = {
  login: "acme",
  kind: "org",
  github_installation_id: 42,
  scope_label: "Org",
  source: "oauth+installation",
};
const personalTarget: GithubRepoOwnerTarget = {
  login: "alex",
  kind: "personal",
  github_installation_id: 7,
  scope_label: "Personal",
  source: "oauth+installation",
};

function appDeps(minted: number[] = []) {
  return {
    appConfigured: () => true,
    createInstallationToken: async (installationId: number) => {
      minted.push(installationId);
      return { token: `installation-${installationId}` };
    },
  };
}

it("creates through the org installation, never the user's grant, in an App deployment", async () => {
  const minted: number[] = [];
  const credential = await resolveGithubRepoCreateCredential(
    orgTarget,
    "identity-token",
    appDeps(minted)
  );
  expect(credential).toEqual({
    ok: true,
    token: "installation-42",
    viaInstallation: true,
  });
  expect(minted).toEqual([42]);
});

it("refuses an org without an installation in an App deployment", async () => {
  const minted: number[] = [];
  const credential = await resolveGithubRepoCreateCredential(
    { ...orgTarget, github_installation_id: null },
    "identity-token",
    appDeps(minted)
  );
  expect(credential).toMatchObject({
    ok: false,
    status: 403,
    code: "GITHUB_APP_INSTALLATION_REQUIRED",
  });
  expect(minted).toEqual([]);
});

it("refuses a personal account in an App deployment even when it has an installation", async () => {
  const minted: number[] = [];
  const credential = await resolveGithubRepoCreateCredential(
    personalTarget,
    "identity-token",
    appDeps(minted)
  );
  expect(credential).toMatchObject({
    ok: false,
    status: 403,
    code: "GITHUB_APP_USER_AUTHORIZATION_REQUIRED",
  });
  expect(minted).toEqual([]);
});

it("keeps the user's repository grant in an OAuth-only deployment", async () => {
  const credential = await resolveGithubRepoCreateCredential(
    personalTarget,
    "repo-token",
    {
      appConfigured: () => false,
      createInstallationToken: async () => {
        throw new Error("must not mint an installation token");
      },
    }
  );
  expect(credential).toEqual({
    ok: true,
    token: "repo-token",
    viaInstallation: false,
  });
});

it("reads the identity grant in an App deployment and the repo grant otherwise", async () => {
  const sources = {
    getIdentityToken: async () => "identity-token",
    getRepositoryToken: async () => "repo-token",
  };
  expect(
    await getGithubRepoCreationUserToken("user-1", {
      ...sources,
      appConfigured: () => true,
    })
  ).toBe("identity-token");
  expect(
    await getGithubRepoCreationUserToken("user-1", {
      ...sources,
      appConfigured: () => false,
    })
  ).toBe("repo-token");
});

it("turns an installation GitHub will not mint a token for into an owner action", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const credential = await resolveGithubRepoCreateCredential(
      orgTarget,
      "identity-token",
      {
        appConfigured: () => true,
        createInstallationToken: async () => {
          throw new GithubHttpError(403, '{"message":"suspended"}');
        },
      }
    );
    expect(credential).toMatchObject({
      ok: false,
      status: 409,
      code: "GITHUB_APP_INSTALLATION_UNAVAILABLE",
    });
    expect(JSON.stringify(credential)).not.toContain("suspended");
  } finally {
    warn.mockRestore();
  }
});

it("names the missing App permission instead of GitHub's refusal", () => {
  const refusal = new GithubRepoCreateError(
    403,
    '{"message":"Resource not accessible by integration"}'
  );
  const viaInstallation = githubRepoCreateErrorResponse(refusal, {
    ownerLogin: "acme",
    viaInstallation: true,
  });
  expect(viaInstallation.status).toBe(403);
  expect(viaInstallation.body.code).toBe("GITHUB_APP_PERMISSION_REQUIRED");
  expect(
    githubRepoCreateErrorResponse(refusal, {
      ownerLogin: "acme",
      viaInstallation: false,
    })
  ).toEqual({
    status: 403,
    body: { error: "Resource not accessible by integration" },
  });
});

it("maps a name collision to 409 and other GitHub failures to 502", () => {
  const context = { ownerLogin: "acme", viaInstallation: true };
  expect(
    githubRepoCreateErrorResponse(new GithubRepoCreateError(422, "{}"), context)
      .status
  ).toBe(409);
  expect(
    githubRepoCreateErrorResponse(new GithubRepoCreateError(500, "{}"), context)
  ).toEqual({ status: 502, body: { error: "GitHub repo creation failed" } });
});

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

type Membership = { role?: "admin" | "member"; state?: "active" | "pending" };
const activeOwner: Membership = { role: "admin", state: "active" };

function appDeps(minted: number[] = [], membership: Membership = activeOwner) {
  return {
    appConfigured: () => true,
    fetchOrgMembership: async () => membership,
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

it("reports a token failure that no org owner can fix as retryable", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    for (const failure of [
      new GithubHttpError(503, "{}"),
      new Error("fetch failed"),
    ]) {
      const credential = await resolveGithubRepoCreateCredential(
        orgTarget,
        "identity-token",
        {
          ...appDeps(),
          createInstallationToken: async () => {
            throw failure;
          },
        }
      );
      expect(credential).toMatchObject({
        status: 502,
        code: "GITHUB_APP_UNAVAILABLE",
      });
    }
  } finally {
    warn.mockRestore();
  }
});

it("reports a rejected App key as a deployment problem, not a retry", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const credential = await resolveGithubRepoCreateCredential(
      orgTarget,
      "identity-token",
      {
        ...appDeps(),
        createInstallationToken: async () => {
          throw new GithubHttpError(401, "{}");
        },
      }
    );
    expect(credential).toMatchObject({
      status: 500,
      code: "GITHUB_APP_MISCONFIGURED",
    });
    expect(error).toHaveBeenCalledOnce();
  } finally {
    warn.mockRestore();
    error.mockRestore();
  }
});

it("turns an installation GitHub will not mint a token for into an owner action", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const credential = await resolveGithubRepoCreateCredential(
      orgTarget,
      "identity-token",
      {
        ...appDeps(),
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

it("names the missing App permission and keeps GitHub's refusal as detail", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
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
  expect(viaInstallation.body.detail).toBe(
    "Resource not accessible by integration"
  );
  expect(
    githubRepoCreateErrorResponse(refusal, {
      ownerLogin: "acme",
      viaInstallation: false,
    })
  ).toEqual({
    status: 403,
    body: { error: "Resource not accessible by integration" },
  });
  expect(warn).toHaveBeenCalledOnce();
  warn.mockRestore();
});

it("keeps GitHub's message for an installation 403 that is not a permission refusal", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const response = githubRepoCreateErrorResponse(
    new GithubRepoCreateError(
      403,
      '{"message":"You have exceeded a secondary rate limit."}'
    ),
    { ownerLogin: "acme", viaInstallation: true }
  );
  expect(response).toEqual({
    status: 403,
    body: { error: "You have exceeded a secondary rate limit." },
  });
  warn.mockRestore();
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

it("refuses a member who is not an active owner before minting a token", async () => {
  const minted: number[] = [];
  const member = await resolveGithubRepoCreateCredential(
    orgTarget,
    "identity-token",
    appDeps(minted, { role: "member", state: "active" })
  );
  expect(member).toMatchObject({
    ok: false,
    status: 403,
    code: "GITHUB_ORG_OWNER_REQUIRED",
  });
  const pendingOwner = await resolveGithubRepoCreateCredential(
    orgTarget,
    "identity-token",
    appDeps(minted, { role: "admin", state: "pending" })
  );
  expect(pendingOwner).toMatchObject({ code: "GITHUB_ORG_OWNER_REQUIRED" });
  expect(minted).toEqual([]);
});

it("treats a non-member as not an owner and a revoked grant as reconnect", async () => {
  const membershipError = (status: number) => ({
    ...appDeps(),
    fetchOrgMembership: async () => {
      throw new GithubHttpError(status, "{}");
    },
  });
  await expect(
    resolveGithubRepoCreateCredential(
      orgTarget,
      "identity-token",
      membershipError(404)
    )
  ).resolves.toMatchObject({ status: 403, code: "GITHUB_ORG_OWNER_REQUIRED" });
  await expect(
    resolveGithubRepoCreateCredential(
      orgTarget,
      "identity-token",
      membershipError(401)
    )
  ).resolves.toMatchObject({
    status: 400,
    code: "GITHUB_REAUTHORIZE_REQUIRED",
    reauthorizeScope: "read:org",
  });
});

it("reports an unreadable membership as retryable, not as a refusal", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const credential = await resolveGithubRepoCreateCredential(
      orgTarget,
      "identity-token",
      {
        ...appDeps(),
        fetchOrgMembership: async () => {
          throw new Error("GitHub owner lookup failed (502)");
        },
      }
    );
    expect(credential).toMatchObject({
      ok: false,
      status: 502,
      code: "GITHUB_MEMBERSHIP_UNAVAILABLE",
    });
  } finally {
    warn.mockRestore();
  }
});

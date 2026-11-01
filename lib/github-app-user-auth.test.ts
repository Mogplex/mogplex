import { expect, it } from "vitest";
import {
  buildGithubAppUserAuthorizeUrl,
  exchangeGithubAppUserCode,
  getGithubAppUserToken,
  type GithubAppUserGrant,
  hasGithubAppUserAuthConfig,
  hasGithubAppUserGrant,
} from "./github-app-user-auth";

const env = {
  GITHUB_APP_CLIENT_ID: "Iv23client",
  GITHUB_APP_CLIENT_SECRET: "secret",
};
const NOW = 1_800_000_000_000;

function grant(
  overrides: Partial<GithubAppUserGrant> = {}
): GithubAppUserGrant {
  return {
    login: "Alex",
    accessToken: "ghu_current",
    accessTokenExpiresAt: NOW + 60 * 60 * 1000,
    refreshToken: "ghr_current",
    refreshTokenExpiresAt: NOW + 30 * 24 * 60 * 60 * 1000,
    ...overrides,
  };
}

function store(initial: GithubAppUserGrant | null) {
  const state = {
    raw: initial ? JSON.stringify(initial) : null,
    deleted: 0,
    requests: [] as URLSearchParams[],
  };
  return {
    state,
    deps: (response: unknown) => ({
      env,
      now: () => NOW,
      getToken: async () => state.raw,
      storeToken: async (_userId: string, value: string) => {
        state.raw = value;
      },
      deleteToken: async () => {
        state.deleted += 1;
        state.raw = null;
      },
      fetch: async (_url: string, init?: RequestInit) => {
        state.requests.push(new URLSearchParams(String(init?.body)));
        if (response instanceof Error) throw response;
        return Response.json(response);
      },
    }),
  };
}

it("is configured only with both App client credentials", () => {
  expect(hasGithubAppUserAuthConfig(env)).toBe(true);
  expect(
    hasGithubAppUserAuthConfig({ GITHUB_APP_CLIENT_ID: "Iv23client" })
  ).toBe(false);
});

it("builds the App authorize URL with state and redirect", () => {
  const url = new URL(
    buildGithubAppUserAuthorizeUrl({
      state: "s1",
      redirectUri: "https://mogplex.com/api/auth/github/app-user/callback",
      env,
    })
  );
  expect(url.origin + url.pathname).toBe(
    "https://github.com/login/oauth/authorize"
  );
  expect(url.searchParams.get("client_id")).toBe("Iv23client");
  expect(url.searchParams.get("state")).toBe("s1");
});

it("exchanges a code and records when each token expires", async () => {
  const { deps } = store(null);
  const tokens = await exchangeGithubAppUserCode(
    "code-1",
    "https://mogplex.com/cb",
    deps({
      access_token: "ghu_new",
      expires_in: 28_800,
      refresh_token: "ghr_new",
      refresh_token_expires_in: 15_897_600,
    })
  );
  expect(tokens).toEqual({
    accessToken: "ghu_new",
    accessTokenExpiresAt: NOW + 28_800_000,
    refreshToken: "ghr_new",
    refreshTokenExpiresAt: NOW + 15_897_600_000,
  });
});

it("rejects an exchange GitHub answers with an error", async () => {
  const { deps } = store(null);
  await expect(
    exchangeGithubAppUserCode(
      "code-1",
      "https://mogplex.com/cb",
      deps({ error: "bad_verification_code" })
    )
  ).rejects.toThrow("bad_verification_code");
});

it("returns a fresh token without refreshing", async () => {
  const { state, deps } = store(grant());
  await expect(getGithubAppUserToken("user-1", "alex", deps({}))).resolves.toBe(
    "ghu_current"
  );
  expect(state.requests).toEqual([]);
});

it("never returns a grant made for another GitHub account", async () => {
  const { deps } = store(grant());
  await expect(
    getGithubAppUserToken("user-1", "someone-else", deps({}))
  ).resolves.toBeNull();
});

it("refreshes a token about to expire and stores the rotated grant", async () => {
  const { state, deps } = store(
    grant({ accessTokenExpiresAt: NOW + 60 * 1000 })
  );
  const token = await getGithubAppUserToken(
    "user-1",
    "alex",
    deps({
      access_token: "ghu_rotated",
      expires_in: 28_800,
      refresh_token: "ghr_rotated",
      refresh_token_expires_in: 15_897_600,
    })
  );
  expect(token).toBe("ghu_rotated");
  expect(state.requests[0]?.get("grant_type")).toBe("refresh_token");
  expect(state.requests[0]?.get("refresh_token")).toBe("ghr_current");
  expect(JSON.parse(state.raw ?? "{}")).toMatchObject({
    login: "Alex",
    accessToken: "ghu_rotated",
    refreshToken: "ghr_rotated",
  });
});

it("forgets a grant whose refresh token GitHub rejects", async () => {
  const { state, deps } = store(grant({ accessTokenExpiresAt: NOW }));
  await expect(
    getGithubAppUserToken(
      "user-1",
      "alex",
      deps({ error: "bad_refresh_token" })
    )
  ).resolves.toBeNull();
  expect(state.deleted).toBe(1);
});

it("uses the grant a concurrent refresh stored instead of deleting it", async () => {
  const { state, deps } = store(grant({ accessTokenExpiresAt: NOW }));
  const rotated = JSON.stringify(
    grant({ accessToken: "ghu_winner", refreshToken: "ghr_winner" })
  );
  const base = deps({ error: "bad_refresh_token" });
  const token = await getGithubAppUserToken("user-1", "alex", {
    ...base,
    fetch: async (url: string, init?: RequestInit) => {
      // The other request rotated the grant while this one was in flight.
      state.raw = rotated;
      return base.fetch(url, init);
    },
  });
  expect(token).toBe("ghu_winner");
  expect(state.deleted).toBe(0);
  expect(state.raw).toBe(rotated);
});

it("keeps every grant when GitHub rejects the client credentials", async () => {
  const { state, deps } = store(grant({ accessTokenExpiresAt: NOW }));
  await expect(
    getGithubAppUserToken(
      "user-1",
      "alex",
      deps({ error: "incorrect_client_credentials" })
    )
  ).rejects.toThrow("incorrect_client_credentials");
  expect(state.deleted).toBe(0);
});

it("keeps the grant and throws when GitHub is unreachable during refresh", async () => {
  const { state, deps } = store(grant({ accessTokenExpiresAt: NOW }));
  await expect(
    getGithubAppUserToken("user-1", "alex", deps(new Error("fetch failed")))
  ).rejects.toThrow("fetch failed");
  expect(state.deleted).toBe(0);
});

it("asks for authorization again once the refresh token has expired", async () => {
  const { state, deps } = store(
    grant({ accessTokenExpiresAt: NOW, refreshTokenExpiresAt: NOW - 1 })
  );
  await expect(
    getGithubAppUserToken("user-1", "alex", deps({}))
  ).resolves.toBeNull();
  expect(state.requests).toEqual([]);
  await expect(hasGithubAppUserGrant("user-1", "alex", deps({}))).resolves.toBe(
    false
  );
});

it("reports a live grant for the matching account", async () => {
  const { deps } = store(grant());
  await expect(hasGithubAppUserGrant("user-1", "ALEX", deps({}))).resolves.toBe(
    true
  );
  await expect(
    hasGithubAppUserGrant("user-1", "other", deps({}))
  ).resolves.toBe(false);
});

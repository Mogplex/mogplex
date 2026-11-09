import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { GithubInstallation } from "@/lib/github-app";
import { reconcileGithubInstallationsForUser } from "./github-installations";

type Upsert = Array<{ installation_id: number; account_login: string | null }>;

function fixture({
  attached = [] as string[],
  loadError = null as { message: string } | null,
  orgs = ["member-org", "outsider-org"],
  members = new Set(["member-org"]),
} = {}) {
  const upserts: Upsert[] = [];
  const db = {
    from: (table: string) => ({
      select: () => ({
        eq: async () => ({
          data: attached.map((account_login) => ({ account_login })),
          error: loadError,
        }),
      }),
      upsert: async (rows: Upsert) => {
        expect(table).toBe("github_installations");
        upserts.push(rows);
        return { error: null };
      },
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  };
  const installations: Record<string, GithubInstallation> = {
    "member-org": {
      id: 11,
      account: { login: "member-org", type: "Organization" },
    },
    "outsider-org": {
      id: 12,
      account: { login: "outsider-org", type: "Organization" },
    },
  };
  const deps = {
    db: db as never,
    request: vi.fn(async () =>
      Response.json(orgs.map((login) => ({ login })))
    ) as unknown as typeof fetch,
    findInstallation: vi.fn(
      async (account: string) => installations[account] ?? null
    ),
    verifyMember: vi.fn(
      async (installation: GithubInstallation, _login?: string | null) =>
        members.has(installation.account?.login ?? "")
    ),
    fetchLogin: vi.fn(async (token: string | null | undefined) =>
      token ? "member" : null
    ),
    syncRepos: vi.fn(async () => undefined) as never,
  };
  return { deps, upserts };
}

beforeEach(() => {
  vi.stubEnv("GITHUB_APP_ID", "1");
  vi.stubEnv("GITHUB_APP_NAME", "fixture");
  vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "configured");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

it("should attach installations on orgs the user is a verified member of", async () => {
  const { deps, upserts } = fixture();
  expect(
    await reconcileGithubInstallationsForUser(
      "fixture-user",
      "member",
      "identity-fixture",
      deps
    )
  ).toEqual({ discovered: 1 });
  expect(upserts.flat().map((row) => row.installation_id)).toEqual([11]);
  expect(deps.verifyMember).toHaveBeenCalledWith(
    expect.objectContaining({ id: 12 }),
    "member"
  );
});

it("should skip accounts that are already attached even when other installations exist", async () => {
  const { deps, upserts } = fixture({ attached: ["MEMBER-ORG", "member"] });
  expect(
    await reconcileGithubInstallationsForUser(
      "fixture-user",
      "member",
      "identity-fixture",
      deps
    )
  ).toEqual({ discovered: 0 });
  expect(deps.findInstallation).toHaveBeenCalledTimes(1);
  expect(deps.findInstallation).toHaveBeenCalledWith("outsider-org");
  expect(upserts).toEqual([]);
});

it("should not attach anything without an identity token", async () => {
  const { deps } = fixture();
  expect(
    await reconcileGithubInstallationsForUser(
      "fixture-user",
      "member",
      null,
      deps
    )
  ).toEqual({ discovered: 0 });
  expect(deps.request).not.toHaveBeenCalled();
  expect(deps.findInstallation).not.toHaveBeenCalled();
});

it("should check membership for the login the token reports, not a stored one", async () => {
  const { deps } = fixture();
  await reconcileGithubInstallationsForUser(
    "fixture-user",
    "stale-login",
    "identity-fixture",
    deps
  );
  expect(deps.findInstallation).not.toHaveBeenCalledWith("stale-login");
  for (const [, login] of deps.verifyMember.mock.calls)
    expect(login).toBe("member");
});

it("should not guess grants after a failed database lookup", async () => {
  const { deps } = fixture({ loadError: { message: "unavailable" } });
  await expect(
    reconcileGithubInstallationsForUser("fixture-user", "member", null, deps)
  ).rejects.toThrow("existing GitHub installations");
});

it("should not discover App installations in an OAuth-only deployment", async () => {
  vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "");
  const { deps } = fixture();
  expect(
    await reconcileGithubInstallationsForUser(
      "fixture-user",
      "member",
      "identity-fixture",
      deps
    )
  ).toEqual({ discovered: 0 });
  expect(deps.findInstallation).not.toHaveBeenCalled();
});

it("should discover orgs beyond the first page of memberships", async () => {
  const { deps, upserts } = fixture();
  const firstPage = Array.from({ length: 100 }, (_, index) => ({
    login: `filler-${index}`,
  }));
  deps.request = vi.fn(async (url: string | URL | Request) =>
    Response.json(
      new URL(String(url)).searchParams.get("page") === "1"
        ? firstPage
        : [{ login: "member-org" }]
    )
  ) as unknown as typeof fetch;
  expect(
    await reconcileGithubInstallationsForUser(
      "fixture-user",
      "member",
      "identity-fixture",
      deps
    )
  ).toEqual({ discovered: 1 });
  expect(upserts.flat().map((row) => row.installation_id)).toEqual([11]);
  expect(deps.request).toHaveBeenCalledTimes(2);
});

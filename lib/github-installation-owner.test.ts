import { expect, it, vi } from "vitest";
import {
  fetchGithubIdentityLogin,
  verifyGithubInstallationOwner,
} from "./github-installation-owner";

const org = {
  id: 7,
  account: { login: "member-org", type: "Organization" },
};

function orgDeps(response: () => Response) {
  const paths: string[] = [];
  const createInstallationAccessToken = vi.fn(async (id: number) => {
    expect(id).toBe(7);
    return { token: "installation-fixture" };
  });
  const request = vi.fn(
    async (url: string | URL | Request, init?: RequestInit) => {
      paths.push(new URL(String(url)).pathname);
      expect(new Headers(init?.headers).get("Authorization")).toBe(
        "Bearer installation-fixture"
      );
      return response();
    }
  );
  return { paths, deps: { createInstallationAccessToken, request } };
}

it("should attach a personal installation only to its own account", async () => {
  const request = vi.fn();
  const personal = {
    id: 1,
    account: { login: "VERIFIED-OWNER", type: "User" },
  };
  expect(
    await verifyGithubInstallationOwner(personal, "verified-owner", {
      request,
    })
  ).toBe(true);
  expect(
    await verifyGithubInstallationOwner(personal, "someone-else", { request })
  ).toBe(false);
  expect(request).not.toHaveBeenCalled();
});

it("should accept only active org owners, read with the installation token", async () => {
  for (const [state, role, allowed] of [
    ["active", "admin", true],
    ["active", "member", false],
    ["pending", "admin", false],
  ] as const) {
    const { paths, deps } = orgDeps(() => Response.json({ state, role }));
    expect(await verifyGithubInstallationOwner(org, "org-user", deps)).toBe(
      allowed
    );
    expect(paths).toEqual(["/orgs/member-org/memberships/org-user"]);
  }
});

it("should reject people outside the org", async () => {
  const { deps } = orgDeps(() => new Response(null, { status: 404 }));
  expect(await verifyGithubInstallationOwner(org, "outsider", deps)).toBe(
    false
  );
});

it("should reject missing logins and malformed installations without calling GitHub", async () => {
  const { deps } = orgDeps(() => Response.json({}));
  expect(await verifyGithubInstallationOwner(org, null, deps)).toBe(false);
  expect(await verifyGithubInstallationOwner(org, "  ", deps)).toBe(false);
  expect(await verifyGithubInstallationOwner({ id: 1 }, "org-user", deps)).toBe(
    false
  );
  expect(
    await verifyGithubInstallationOwner(
      { id: 1, account: { login: "bot", type: "Bot" } },
      "org-user",
      deps
    )
  ).toBe(false);
  expect(deps.request).not.toHaveBeenCalled();
});

it("should keep provider outages distinct from a verified non-owner", async () => {
  const { deps } = orgDeps(() => new Response(null, { status: 503 }));
  await expect(
    verifyGithubInstallationOwner(org, "org-user", deps)
  ).rejects.toThrow("ownership could not be verified");
});

it("should read the login live from the identity token", async () => {
  const request = vi.fn(
    async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.github.com/user");
      expect(new Headers(init?.headers).get("Authorization")).toBe(
        "Bearer identity-fixture"
      );
      return Response.json({ login: "current-login" });
    }
  );
  expect(
    await fetchGithubIdentityLogin("identity-fixture", request as never)
  ).toBe("current-login");
  expect(await fetchGithubIdentityLogin(null, request as never)).toBeNull();
  expect(request).toHaveBeenCalledTimes(1);
});

it("should treat a rejected identity token as no login and an outage as an error", async () => {
  expect(
    await fetchGithubIdentityLogin(
      "revoked-fixture",
      async () => new Response(null, { status: 401 })
    )
  ).toBeNull();
  expect(
    await fetchGithubIdentityLogin("identity-fixture", async () =>
      Response.json({})
    )
  ).toBeNull();
  await expect(
    fetchGithubIdentityLogin(
      "identity-fixture",
      async () => new Response(null, { status: 503 })
    )
  ).rejects.toThrow("identity could not be verified");
});

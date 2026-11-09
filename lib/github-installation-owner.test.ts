import { expect, it, vi } from "vitest";
import { verifyGithubInstallationMember } from "./github-installation-owner";

const org = {
  id: 7,
  account: { login: "member-org", type: "Organization" },
};

function orgDeps(status: number) {
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
      return new Response(null, { status });
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
    await verifyGithubInstallationMember(personal, "verified-owner", {
      request,
    })
  ).toBe(true);
  expect(
    await verifyGithubInstallationMember(personal, "someone-else", { request })
  ).toBe(false);
  expect(request).not.toHaveBeenCalled();
});

it("should accept any org member, checked with the installation token", async () => {
  const { paths, deps } = orgDeps(204);
  expect(await verifyGithubInstallationMember(org, "plain-member", deps)).toBe(
    true
  );
  expect(paths).toEqual(["/orgs/member-org/members/plain-member"]);
});

it("should reject non-members of an org installation", async () => {
  for (const status of [404, 302]) {
    const { deps } = orgDeps(status);
    expect(await verifyGithubInstallationMember(org, "outsider", deps)).toBe(
      false
    );
  }
});

it("should reject missing logins and malformed installations without calling GitHub", async () => {
  const { deps } = orgDeps(204);
  expect(await verifyGithubInstallationMember(org, null, deps)).toBe(false);
  expect(await verifyGithubInstallationMember(org, "  ", deps)).toBe(false);
  expect(
    await verifyGithubInstallationMember({ id: 1 }, "plain-member", deps)
  ).toBe(false);
  expect(
    await verifyGithubInstallationMember(
      { id: 1, account: { login: "bot", type: "Bot" } },
      "plain-member",
      deps
    )
  ).toBe(false);
  expect(deps.request).not.toHaveBeenCalled();
});

it("should keep provider outages distinct from a verified non-member", async () => {
  const { deps } = orgDeps(503);
  await expect(
    verifyGithubInstallationMember(org, "plain-member", deps)
  ).rejects.toThrow("membership could not be verified");
});

import { expect, it, vi } from "vitest";
import { verifyGithubInstallationOwner } from "./github-installation-owner";

it("requires the verified GitHub identity to own a personal installation", async () => {
  const request = vi.fn(
    async (_url: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("Authorization")).toBe(
        "Bearer identity-only-fixture"
      );
      return Response.json({ login: "verified-owner" });
    }
  );
  expect(
    await verifyGithubInstallationOwner(
      { id: 1, account: { login: "VERIFIED-OWNER", type: "User" } },
      "identity-only-fixture",
      request
    )
  ).toBe(true);
  expect(
    await verifyGithubInstallationOwner(
      { id: 2, account: { login: "someone-else", type: "User" } },
      "identity-only-fixture",
      request
    )
  ).toBe(false);
  expect(
    request.mock.calls.every(
      ([url]) => String(url) === "https://api.github.com/user"
    )
  ).toBe(true);
});
it("requires active organization ownership and never accepts ordinary membership", async () => {
  for (const [state, role, allowed] of [
    ["active", "admin", true],
    ["active", "member", false],
    ["pending", "admin", false],
  ] as const) {
    const paths: string[] = [];
    const request = async (url: string | URL | Request) => {
      const path = new URL(String(url)).pathname;
      paths.push(path);
      return Response.json(
        path === "/user" ? { login: "verified-user" } : { state, role }
      );
    };
    expect(
      await verifyGithubInstallationOwner(
        { id: 1, account: { login: "approved-org", type: "Organization" } },
        "identity-fixture",
        request
      )
    ).toBe(allowed);
    expect(paths).toEqual(["/user", "/user/memberships/orgs/approved-org"]);
  }
});
it("denies missing identities, inaccessible accounts, and malformed provider responses", async () => {
  for (const response of [
    new Response(null, { status: 401 }),
    Response.json({}),
    Response.json([]),
  ]) {
    expect(
      await verifyGithubInstallationOwner(
        { id: 1, account: { login: "approved", type: "User" } },
        "identity-fixture",
        async () => response
      )
    ).toBe(false);
  }
  const request = vi.fn();
  expect(
    await verifyGithubInstallationOwner({ id: 1 }, "identity-fixture", request)
  ).toBe(false);
  expect(
    await verifyGithubInstallationOwner(
      { id: 1, account: { login: "approved", type: "User" } },
      "",
      request
    )
  ).toBe(false);
  expect(request).not.toHaveBeenCalled();
});
it("keeps provider outages distinct from a verified lack of ownership", async () => {
  await expect(
    verifyGithubInstallationOwner(
      { id: 1, account: { login: "approved", type: "User" } },
      "identity-fixture",
      async () => new Response(null, { status: 503 })
    )
  ).rejects.toThrow("ownership could not be verified");
});

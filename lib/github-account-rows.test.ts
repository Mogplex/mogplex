import { describe, expect, it } from "vitest";
import { buildGithubAccountRows } from "./github-account-rows";

const installation = (
  overrides: Partial<Parameters<typeof buildGithubAccountRows>[0][number]>
) => ({
  id: "inst-1",
  installation_id: 1,
  account_login: "acme",
  scope_label: "Org",
  synced_repo_count: 0,
  manage_url: null,
  repositories: [],
  ...overrides,
});

describe("buildGithubAccountRows", () => {
  it("should show an account once when it is both connectable and connected", () => {
    const rows = buildGithubAccountRows(
      [installation({ account_login: "Acme" })],
      [
        { login: "acme", kind: "org" },
        { login: "alex", kind: "personal" },
      ]
    );

    expect(
      rows.map((row) => [row.login, row.kind, row.connection !== null])
    ).toEqual([
      ["Acme", "Organization", true],
      ["alex", "Personal account", false],
    ]);
  });

  it("should list connected accounts before ones still to connect", () => {
    const rows = buildGithubAccountRows(
      [installation({ account_login: "zeta" })],
      [{ login: "beta", kind: "org" }]
    );

    expect(rows.map((row) => row.login)).toEqual(["zeta", "beta"]);
  });

  it("should preview three repositories and count the rest", () => {
    const repositories = ["a", "b", "c", "d", "e"].map((name) => ({
      id: name,
      full_name: `acme/${name}`,
    }));

    const [row] = buildGithubAccountRows(
      [installation({ repositories, synced_repo_count: 5 })],
      []
    );

    expect(row?.connection).toMatchObject({
      syncedRepoCount: 5,
      repoPreview: ["acme/a", "acme/b", "acme/c"],
      moreRepoCount: 2,
    });
  });

  it("should name a personal installation and fall back when the login is missing", () => {
    const rows = buildGithubAccountRows(
      [
        installation({ id: "a", account_login: "alex", scope_label: "User" }),
        installation({
          id: "b",
          installation_id: 42,
          account_login: null,
          scope_label: "Account",
        }),
      ],
      []
    );

    expect(rows.map((row) => [row.login, row.kind])).toEqual([
      ["alex", "Personal account"],
      ["Installation 42", "Account"],
    ]);
  });
});

import { describe, expect, it } from "vitest";
import { resolveRunRepository, normalizeRepoFullName } from "./run-repository";

const repos = new Map([
  ["context", { full_name: "Mogplex/mogplex" }],
  ["target", { full_name: "webrenew/gtm-supahost" }],
]);

describe("normalizeRepoFullName", () => {
  it("validates valid full names", () => {
    expect(normalizeRepoFullName("owner/repo")).toBe("owner/repo");
    expect(normalizeRepoFullName("Mogplex/mogplex")).toBe("Mogplex/mogplex");
    expect(normalizeRepoFullName("web-renew/gtm_supahost")).toBe(
      "web-renew/gtm_supahost"
    );
  });

  it("rejects invalid full names", () => {
    expect(normalizeRepoFullName("repo")).toBeNull();
    expect(normalizeRepoFullName("owner/")).toBeNull();
    expect(normalizeRepoFullName("/repo")).toBeNull();
    expect(normalizeRepoFullName("owner/repo/extra")).toBeNull();
    expect(normalizeRepoFullName(123)).toBeNull();
    expect(normalizeRepoFullName(null)).toBeNull();
  });

  it("trims whitespace", () => {
    expect(normalizeRepoFullName("  owner/repo  ")).toBe("owner/repo");
  });
});

describe("resolveRunRepository", () => {
  it("prefers the persisted target over context and current repository data", () => {
    // Test that repo_full_name wins over legacy repo when both are present.
    // In production, legacy `repo` also held the run target (written by
    // buildRunMetadata), so this case exercises precedence, not a real conflict.
    expect(
      resolveRunRepository(
        {
          repo_id: "context",
          metadata: {
            run_origin: "slack",
            repo_full_name: "webrenew/gtm-supahost",
            repo: "webrenew/old-target-snapshot",
          },
        },
        repos
      )
    ).toBe("webrenew/gtm-supahost");
  });

  it("reads legacy Slack snapshots even when the target is absent from the repo picker", () => {
    expect(
      resolveRunRepository(
        {
          repo_id: "removed",
          metadata: {
            run_origin: "slack",
            repo: "webrenew/gtm-supahost",
          },
        },
        repos
      )
    ).toBe("webrenew/gtm-supahost");
  });

  it("falls back only to the call's repository ID, including non-Slack calls", () => {
    expect(
      resolveRunRepository({ repo_id: "target", metadata: {} }, repos)
    ).toBe("webrenew/gtm-supahost");
  });

  it.each([
    null,
    {},
    { repo: "gtm-supahost" },
    { repo_full_name: 123, repo: {} },
    {
      context_repo: "Mogplex/mogplex",
      slack: { repository: "Mogplex/mogplex" },
    },
  ])(
    "does not invent attribution for missing or malformed metadata: %j",
    (metadata) => {
      expect(
        resolveRunRepository({ repo_id: null, metadata }, repos)
      ).toBeNull();
      expect(
        resolveRunRepository({ repo_id: "missing", metadata }, repos)
      ).toBeNull();
    }
  );
});

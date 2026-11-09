import { describe, expect, it } from "vitest";
import type { Flow, FlowStartFilter } from "@/lib/types";
import {
  automationsForOwner,
  githubAutomations,
  latestRepoSync,
  toTriggerAccountType,
} from "./owner-automations";

const flow = (
  id: string,
  filter: FlowStartFilter | undefined,
  overrides: Partial<Flow> = {}
) =>
  ({
    id,
    name: id,
    status: "active",
    source_kind: "github",
    published_version: {
      id: `${id}-v1`,
      flow_id: id,
      version_number: 1,
      created_at: "2026-11-09T00:00:00Z",
      graph: {
        nodes: [
          {
            id: "start",
            type: "start",
            position: { x: 0, y: 0 },
            data: { label: "PR opened", event: "pr_opened", filter },
          },
        ],
        edges: [],
      },
    },
    ...overrides,
  }) as Pick<
    Flow,
    "id" | "name" | "status" | "source_kind" | "published_version"
  >;

describe("githubAutomations", () => {
  it("should keep only active, published, GitHub-triggered automations", () => {
    const automations = githubAutomations([
      flow("review", { scope: "all" }),
      flow("paused", { scope: "all" }, { status: "inactive" }),
      flow("nightly", undefined, { source_kind: "schedule" }),
      flow("draft", undefined, { published_version: null }),
    ]);

    expect(automations.map((a) => a.id)).toEqual(["review"]);
    expect(automations[0].filter).toEqual({ scope: "all" });
  });
});

describe("automationsForOwner", () => {
  const repos = [
    { full_name: "acme/app", github_installation_id: 7 },
    { full_name: "acme/site", github_installation_id: 7 },
  ];

  it("should match automations whose trigger filter accepts any of the owner's repositories", () => {
    const automations = githubAutomations([
      flow("all", { scope: "all", authorFilter: "dependabot_only" }),
      flow("orgs", { scope: "org" }),
      flow("personal", { scope: "personal" }),
      flow("site-only", { scope: "all", repos: ["acme/site"] }),
      flow("other-repo", { scope: "all", repos: ["zed/x"] }),
      flow("other-install", { scope: "all", installationIds: [9] }),
    ]);

    expect(
      automationsForOwner(automations, repos, "Organization").map((a) => a.id)
    ).toEqual(["all", "orgs", "site-only"]);
  });

  it("should match nothing without a known account type or installation", () => {
    const automations = githubAutomations([flow("all", { scope: "all" })]);

    expect(automationsForOwner(automations, repos, null)).toEqual([]);
    expect(
      automationsForOwner(
        automations,
        [{ full_name: "legacy/docs", github_installation_id: null }],
        "User"
      )
    ).toEqual([]);
  });
});

describe("toTriggerAccountType", () => {
  it("should map GitHub account types to trigger filter account types", () => {
    expect(toTriggerAccountType("Organization")).toBe("Organization");
    expect(toTriggerAccountType("User")).toBe("User");
    expect(toTriggerAccountType(null)).toBeNull();
  });
});

describe("latestRepoSync", () => {
  it("should return the most recent sync time across installations", () => {
    expect(
      latestRepoSync([
        { repos_synced_at: "2026-11-09T10:00:00Z" },
        { repos_synced_at: null },
        { repos_synced_at: "2026-11-09T12:00:00Z" },
      ])
    ).toBe("2026-11-09T12:00:00Z");
    expect(latestRepoSync([{ repos_synced_at: null }])).toBeNull();
  });
});

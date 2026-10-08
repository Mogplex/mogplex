import { describe, expect, it } from "vitest";
import { resolveRunRepository } from "./run-repository";

const repos = new Map([
  ["context", { full_name: "Mogplex/mogplex" }],
  ["target", { full_name: "webrenew/gtm-supahost" }],
]);

describe("run repository attribution", () => {
  it("prefers the persisted target over context and current repository data", () => {
    expect(
      resolveRunRepository(
        {
          repo_id: "context",
          metadata: {
            run_origin: "slack",
            repo_full_name: "webrenew/gtm-supahost",
            repo: "Mogplex/mogplex",
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

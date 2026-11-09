import { describe, expect, it } from "vitest";
import type { Flow, FlowStartFilter } from "@/lib/types";
import { githubAutomations } from "./github-automation-triggers";

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

  it("should drop a published graph the router cannot start", () => {
    const noStart = flow("partial", { scope: "all" });
    if (noStart.published_version) noStart.published_version.graph.nodes = [];

    expect(githubAutomations([noStart])).toEqual([]);
  });
});

import { tool } from "ai";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { filterToolsByCapability } from "./tool-capabilities";
import type { Capability } from "@/lib/team-capabilities";

const fixtureTool = tool({ inputSchema: z.object({}) });

describe("tool capability filtering", () => {
  it("retains unrestricted owner access, including tools without a registry tag", () => {
    const filtered = filterToolsByCapability(
      { github_merge_pull_request: fixtureTool, unregistered: fixtureTool },
      new Set<Capability>(["*"])
    );
    expect(Object.keys(filtered)).toEqual([
      "github_merge_pull_request",
      "unregistered",
    ]);
  });
  it("refuses merge discovery when no denial observer is supplied", () => {
    expect(
      Object.keys(
        filterToolsByCapability(
          { github_merge_pull_request: fixtureTool },
          new Set<Capability>(["tools.github_api"])
        )
      )
    ).toEqual([]);
  });
  it("refuses unregistered tools even when registered merge tools are allowed", () => {
    const filtered = filterToolsByCapability(
      { github_merge_pull_request: fixtureTool, unregistered: fixtureTool },
      new Set<Capability>(["tools.github_merge"])
    );
    expect(Object.keys(filtered)).toEqual(["github_merge_pull_request"]);
  });
  it("reports a denied merge separately from allowed issue tools", () => {
    const denied: unknown[] = [];
    const filtered = filterToolsByCapability(
      {
        github_merge_pull_request: fixtureTool,
        github_create_issue: fixtureTool,
      },
      new Set<Capability>(["tools.github_api"]),
      undefined,
      (name, capability) => denied.push([name, capability])
    );
    expect(Object.keys(filtered)).toEqual(["github_create_issue"]);
    expect(denied).toEqual([
      ["github_merge_pull_request", "tools.github_merge"],
    ]);
  });
});

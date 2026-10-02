import { describe, expect, it } from "vitest";
import {
  GENERAL_GROUP_NAME,
  groupSessionsByProject,
  projectColorClass,
} from "./session-groups";

it("groups named but unlinked sessions separately from a linked repository", () => {
  const updated_at = "2026-10-02T12:00:00Z";
  const groups = groupSessionsByProject([
    { id: "linked", repo_id: "repo", project: "acme/widgets", updated_at },
    { id: "legacy", repo_id: null, project: "acme/widgets", updated_at },
    { id: "ambiguous", project: "widgets", updated_at },
  ]);
  expect(
    groups.map((group) => [
      group.name,
      group.project,
      group.sessions.map((s) => s.id),
    ])
  ).toEqual([
    ["acme/widgets", "acme/widgets", ["linked"]],
    ["Unlinked", null, ["legacy", "ambiguous"]],
  ]);
});

describe("project identity colors", () => {
  it("uses a neutral marker for the unassigned General group", () => {
    expect(projectColorClass(GENERAL_GROUP_NAME)).toBe("bg-project-neutral");
  });

  it("keeps each named project's Geist color independent of list order", () => {
    const names = [
      "acme/alpha",
      "acme/beta",
      "acme/gamma",
      "Mogplex/mogplex",
      "mogplex",
    ];
    const colors = names.map(projectColorClass);
    expect(new Set(colors).size).toBe(names.length);
    expect([...names].reverse().map(projectColorClass).reverse()).toEqual(
      colors
    );
    for (const color of colors) {
      expect(color).toMatch(
        /^bg-project-(blue|amber|green|red|teal|purple|pink)$/
      );
    }
  });
});

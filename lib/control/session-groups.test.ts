import { describe, expect, it } from "vitest";
import { GENERAL_GROUP_NAME, projectColorClass } from "./session-groups";

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

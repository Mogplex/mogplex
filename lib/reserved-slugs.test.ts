import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { isReservedSlug } from "./reserved-slugs";
import { isDashboardScopedFirstSegment } from "./dashboard-rescue";

describe("reserved workspace slugs", () => {
  it("reserves checkout without regard to case", () => {
    expect(isReservedSlug("checkout")).toBe(true);
    expect(isReservedSlug("CHECKOUT")).toBe(true);
  });

  it.each(["control", "signup"])("rejects %s as a workspace slug", (slug) => {
    expect(isReservedSlug(slug)).toBe(true);
  });

  for (const directory of ["app", "app/(dashboard)/[scope]"]) {
    it(`reserves every static route under ${directory}`, () => {
      const segments = readdirSync(join(process.cwd(), directory), {
        withFileTypes: true,
      })
        .filter((entry) => entry.isDirectory() && !/^[([]/.test(entry.name))
        .map((entry) => entry.name);
      expect(segments.length).toBeGreaterThan(0);
      for (const segment of segments) {
        expect(isReservedSlug(segment), segment).toBe(true);
        if (directory !== "app") {
          expect(isDashboardScopedFirstSegment(segment), segment).toBe(true);
        }
      }
    });
  }
});

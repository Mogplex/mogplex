import { describe, expect, it } from "vitest";
import { buildUnifiedDiff } from "./unified";
import { detectPatch } from "./detect";

describe("buildUnifiedDiff", () => {
  it("renders a modified file as a unified diff the patch viewer accepts", () => {
    const diff = buildUnifiedDiff({
      path: "src/app.ts",
      before: "const a = 1;\nconst b = 2;\n",
      after: "const a = 1;\nconst b = 3;\n",
    });
    expect(diff).toContain("--- a/src/app.ts");
    expect(diff).toContain("+++ b/src/app.ts");
    expect(diff).toContain("-const b = 2;");
    expect(diff).toContain("+const b = 3;");
    expect(detectPatch(diff)?.files).toHaveLength(1);
  });

  it("marks a created file against /dev/null", () => {
    const diff = buildUnifiedDiff({
      path: "src/new.ts",
      before: null,
      after: "export {};\n",
    });
    expect(diff).toContain("--- /dev/null");
    expect(diff).toContain("+++ b/src/new.ts");
    expect(diff).toContain("+export {};");
  });

  it("returns an empty string when nothing changed", () => {
    expect(
      buildUnifiedDiff({ path: "a.ts", before: "same\n", after: "same\n" })
    ).toBe("");
  });
});

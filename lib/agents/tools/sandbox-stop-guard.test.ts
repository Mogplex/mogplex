import { describe, expect, it } from "vitest";
import {
  describeUncommittedChanges,
  parseUncommittedChanges,
} from "./sandbox-stop-guard";

describe("parseUncommittedChanges", () => {
  it("reports a clean tree for empty output", () => {
    expect(parseUncommittedChanges("")).toEqual({ status: "clean" });
    expect(parseUncommittedChanges("\n")).toEqual({ status: "clean" });
  });

  it("lists changed paths from porcelain output and caps the sample", () => {
    const lines = Array.from({ length: 10 }, (_, i) => ` M src/file-${i}.ts`);
    const report = parseUncommittedChanges(lines.join("\n") + "\n");
    expect(report.status).toBe("dirty");
    if (report.status !== "dirty") return;
    expect(report.total).toBe(10);
    expect(report.files).toHaveLength(8);
    expect(report.files[0]).toBe("src/file-0.ts");
    expect(describeUncommittedChanges(report)).toMatch(
      /^10 uncommitted change\(s\): src\/file-0\.ts.* and 2 more$/
    );
  });
});

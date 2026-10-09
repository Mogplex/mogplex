import { describe, expect, it } from "vitest";
import { normalizeChecks } from "./github-pr-status";

describe("normalizeChecks", () => {
  it("maps isRequired: true to required: true for CheckRun nodes", () => {
    const result = normalizeChecks([
      { __typename: "CheckRun", name: "ci", isRequired: true },
    ]);
    expect(result).toEqual([
      {
        name: "ci",
        status: null,
        conclusion: null,
        required: true,
        url: null,
      },
    ]);
  });

  it("maps isRequired: false to required: false for CheckRun nodes", () => {
    const result = normalizeChecks([
      { __typename: "CheckRun", name: "lint", isRequired: false },
    ]);
    expect(result[0]?.required).toBe(false);
  });

  it("maps isRequired: null to required: null for CheckRun nodes", () => {
    const result = normalizeChecks([
      { __typename: "CheckRun", name: "unknown-check", isRequired: null },
    ]);
    expect(result[0]?.required).toBe(null);
  });

  it("maps missing isRequired (undefined) to required: null for CheckRun nodes", () => {
    const result = normalizeChecks([
      { __typename: "CheckRun", name: "legacy" },
    ]);
    expect(result[0]?.required).toBe(null);
  });

  it("handles StatusContext nodes the same way", () => {
    const result = normalizeChecks([
      { __typename: "StatusContext", context: "status-a", isRequired: true },
      { __typename: "StatusContext", context: "status-b", isRequired: null },
      { __typename: "StatusContext", context: "status-c" },
    ]);
    expect(result[0]?.required).toBe(true);
    expect(result[1]?.required).toBe(null);
    expect(result[2]?.required).toBe(null);
  });

  it("skips null nodes and unknown types", () => {
    const result = normalizeChecks([
      null,
      { __typename: "Unknown", name: "x" },
      { __typename: "CheckRun", name: "valid" },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("valid");
  });
});

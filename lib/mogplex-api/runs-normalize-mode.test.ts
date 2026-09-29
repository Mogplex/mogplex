import { describe, expect, it } from "vitest";
import { normalizeStartRequest } from "./runs-normalize";

const normalize = (body: Record<string, unknown>) =>
  normalizeStartRequest({
    body: { repoId: "repo", prompt: "Explain the auth flow", ...body },
    repo: {
      id: "repo",
      full_name: "example/app",
      default_branch: "main",
      root_directory: null,
    },
    idempotencyKey: "event",
  }).normalized;

describe("run mode normalization", () => {
  it("should accept SAFE, AUTO, and YOLO in any case", () => {
    expect(normalize({ mode: "safe" }).mode).toBe("SAFE");
    expect(normalize({ mode: "Auto" }).mode).toBe("AUTO");
    expect(normalize({ mode: "YOLO" }).mode).toBe("YOLO");
  });

  it("should leave the mode unset when none is given", () => {
    expect(normalize({}).mode).toBeNull();
    expect(normalize({ mode: "  " }).mode).toBeNull();
  });

  it("should refuse an unknown mode instead of running it as AUTO", () => {
    expect(() => normalize({ mode: "SAF" })).toThrow(
      "mode must be SAFE, AUTO, or YOLO"
    );
  });

  it("should refuse a mode that is not a string", () => {
    for (const mode of [0, true, ["SAFE"], { mode: "SAFE" }]) {
      expect(() => normalize({ mode })).toThrow(
        "mode must be SAFE, AUTO, or YOLO"
      );
    }
  });

  it("should refuse any mode, of any type, for the Mogplex harness", () => {
    for (const mode of ["SAFE", 0, ["SAFE"]]) {
      expect(() =>
        normalize({ harness: "mogplex", createBranch: true, mode })
      ).toThrow("CLI execution modes");
    }
  });
});

import { describe, expect, it } from "vitest";
import { buildLlmsTxt } from "./llms-txt";

describe("buildLlmsTxt", () => {
  it("publishes the capacity plan paths", () => {
    const text = buildLlmsTxt();
    expect(text).toContain(
      "Individual plans by parallel agent runs, Storage, and Inference"
    );
    expect(text).toContain("confirm an Individual plan");
  });
});

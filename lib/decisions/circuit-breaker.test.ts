import { describe, expect, it } from "vitest";
import { createDecisionCircuitBreaker } from "./circuit-breaker";

describe("createDecisionCircuitBreaker", () => {
  it("opens only the failing model's scope", () => {
    const breaker = createDecisionCircuitBreaker();
    for (let index = 0; index < 5; index += 1) {
      breaker.noteResult("model-a", false, new Error("provider down"), 100);
    }

    expect(breaker.isOpen("model-a", 100)).toBe(true);
    expect(breaker.isOpen("model-b", 100)).toBe(false);
  });

  it("does not count request-local 4xx failures", () => {
    const breaker = createDecisionCircuitBreaker();
    const error = Object.assign(new Error("bad request"), { statusCode: 400 });
    for (let index = 0; index < 5; index += 1) {
      breaker.noteResult("model-a", false, error, 100);
    }

    expect(breaker.isOpen("model-a", 100)).toBe(false);
  });

  it("counts timeouts and resets after success or reset", () => {
    const breaker = createDecisionCircuitBreaker();
    const timeout = Object.assign(new Error("timed out"), {
      name: "TimeoutError",
    });
    for (let index = 0; index < 5; index += 1) {
      breaker.noteResult("model-a", false, timeout, 100);
    }
    expect(breaker.isOpen("model-a", 100)).toBe(true);

    breaker.noteResult("model-a", true, null, 101);
    expect(breaker.isOpen("model-a", 101)).toBe(false);

    for (let index = 0; index < 5; index += 1) {
      breaker.noteResult("model-a", false, timeout, 100);
    }
    breaker.reset();
    expect(breaker.isOpen("model-a", 100)).toBe(false);
  });
});
